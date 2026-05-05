import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_FEE_RATE   = 0.22;
const DEFAULT_OPS_FEE    = 3000;
const DEFAULT_PACK_FEE   = 11000;
const DEFAULT_FIXED_FEE  = 1833;
const FIXED_COST         = DEFAULT_OPS_FEE + DEFAULT_PACK_FEE + DEFAULT_FIXED_FEE; // 15833
const TARGET_MARGIN      = { moi: 0.02, core: 0.07, upsell: 0.13 };
const MIN_COMPANY_MARGIN = 0.05;
const MIN_UNIT_DISCOUNT  = 0.10;
const GIAM_GIA_FLOOR     = 0.10;
const GIAM_GIA_DROP      = 0.04;

const REQUEST_DELAY_MS   = 300;
const RATE_LIMIT_RETRIES = 5;

// ─── Utilities ────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isRateLimitError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('429');
}

async function withRetry(fn) {
  let last;
  for (let i = 0; i <= RATE_LIMIT_RETRIES; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!isRateLimitError(e) || i === RATE_LIMIT_RETRIES) break;
      await sleep(1000 * 2 ** i);
    }
  }
  throw last;
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function roundUpCustomerFriendlyPrice(price) {
  const p = toNumber(price);
  if (p <= 0) return 0;
  const step = p >= 100000 ? 1000 : 500;
  const ceiling = Math.ceil(p / step) * step;
  const charm = ceiling - 100;
  return charm >= p ? charm : ceiling;
}

function fmtPrice(n) { return `₫${Math.round(n).toLocaleString('vi-VN')}`; }
function fmtPct(n)   { return `${(n * 100).toFixed(1)}%`; }

// ─── Combo Algorithm ──────────────────────────────────────────────────────────
function getComboQtyCap(unitPrice) {
  return toNumber(unitPrice) > 40000 ? 12 : 24;
}

function findBestCombo(product) {
  const cost       = toNumber(product.cost);
  const unitPrice  = toNumber(product.current_price);
  const feeRate    = toNumber(product.shopee_fee_rate, DEFAULT_FEE_RATE);
  const fixedCost  = toNumber(product.ops_fee, DEFAULT_OPS_FEE)
                   + toNumber(product.packing_fee, DEFAULT_PACK_FEE)
                   + toNumber(product.fixed_fee, DEFAULT_FIXED_FEE);
  const cap        = getComboQtyCap(unitPrice);

  for (let qty = 2; qty <= cap; qty++) {
    const minPrice   = (cost * qty + fixedCost) / (1 - feeRate - MIN_COMPANY_MARGIN);
    const comboPrice = roundUpCustomerFriendlyPrice(minPrice);
    const comboUnit  = qty > 0 ? comboPrice / qty : comboPrice;
    const discount   = unitPrice > 0 ? (unitPrice - comboUnit) / unitPrice : 0;
    const profit     = comboPrice * (1 - feeRate) - cost * qty - fixedCost;
    const margin     = comboPrice > 0 ? profit / comboPrice : 0;

    if (discount >= MIN_UNIT_DISCOUNT && margin >= MIN_COMPANY_MARGIN && comboPrice > 0) {
      return { qty, price: comboPrice, unitPrice: comboUnit, discount, margin };
    }
  }
  return null;
}

// ─── Price Optimizer ──────────────────────────────────────────────────────────
function runPriceOptimizer(product, perfData) {
  const price        = toNumber(product.current_price);
  const cost         = toNumber(product.cost);
  const feeRate      = toNumber(product.shopee_fee_rate, DEFAULT_FEE_RATE);
  const role         = product.sku_role || 'core';
  const targetMargin = TARGET_MARGIN[role] ?? TARGET_MARGIN.core;

  const netRevenue = price * (1 - feeRate);
  const profit     = netRevenue - cost - FIXED_COST;
  const margin     = price > 0 ? profit / price : 0;
  const marginPct  = margin * 100;

  const sorted  = [...perfData].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const perf7   = sorted.slice(0, 7);
  const perf30  = sorted.slice(0, 30);

  const orders7d   = perf7.reduce((s, r)  => s + toNumber(r.orders), 0);
  const orders30d  = perf30.reduce((s, r) => s + toNumber(r.orders), 0);
  const views7d    = perf7.reduce((s, r)  => s + toNumber(r.views), 0);
  const adsSpend7d = perf7.reduce((s, r)  => s + toNumber(r.ads_spend), 0);
  const revenue7d  = perf7.reduce((s, r)  => s + toNumber(r.revenue), 0);
  const cvr        = toNumber((perf7[0] || {}).conversion_rate);
  const cvrPct     = cvr * 100;
  const roas       = adsSpend7d > 0 ? revenue7d / adsSpend7d : 0;

  const minRetailDenom = 1 - feeRate - targetMargin;
  const suggestedBasePrice = minRetailDenom > 0
    ? roundUpCustomerFriendlyPrice((cost + FIXED_COST) / minRetailDenom)
    : 0;

  const comboBest    = findBestCombo(product);

  const dropPrice       = Math.floor((price * (1 - GIAM_GIA_DROP)) / 1000) * 1000;
  const dropProfit      = dropPrice * (1 - feeRate) - cost - FIXED_COST;
  const dropMargin      = dropPrice > 0 ? dropProfit / dropPrice : 0;
  const dropOk          = dropMargin >= GIAM_GIA_FLOOR;

  let action     = 'GIU_GIA';
  let sugPrice   = null;
  let comboQty   = null;
  let reason     = '';
  let confidence = 60;

  if (margin < 0) {
    if (comboBest) {
      action     = 'GOM_COMBO';
      sugPrice   = comboBest.price;
      comboQty   = comboBest.qty;
      reason     = `Lỗ ${fmtPct(-margin)} mỗi đơn (lợi nhuận ${fmtPrice(profit)}/đơn). Gom ${comboBest.qty} sản phẩm → giá combo ${fmtPrice(comboBest.price)} (đơn giá ${fmtPrice(comboBest.unitPrice)}, giảm ${fmtPct(comboBest.discount)} so với lẻ), margin ${fmtPct(comboBest.margin)}. [COMBO_V4_10PCT_CAP_CLEAN_PENDING]`;
      confidence = 85;
    } else {
      action     = 'TANG_GIA';
      sugPrice   = suggestedBasePrice;
      reason     = `Lỗ ${fmtPct(-margin)} mỗi đơn. Cần tăng giá lên ${fmtPrice(suggestedBasePrice)} để đạt mục tiêu margin ${(targetMargin * 100).toFixed(0)}% (role: ${role}). Không thể gom combo đạt giảm ≥10% trong giới hạn qty. [COMBO_V4_10PCT_CAP_CLEAN_PENDING]`;
      confidence = 90;
    }
  } else if (comboBest) {
    action     = 'GOM_COMBO';
    sugPrice   = comboBest.price;
    comboQty   = comboBest.qty;
    reason     = `Gom ${comboBest.qty} sản phẩm → giá combo ${fmtPrice(comboBest.price)} (đơn giá ${fmtPrice(comboBest.unitPrice)}, rẻ hơn ${fmtPct(comboBest.discount)} so với giá lẻ ${fmtPrice(price)}). Margin combo ${fmtPct(comboBest.margin)} ≥ 5%. [COMBO_V4_10PCT_CAP_CLEAN_PENDING]`;
    confidence = 82;
  } else if (orders7d > 15 && margin < targetMargin) {
    const raiseRate = margin < 0.02 ? 0.10 : (margin < 0.05 ? 0.06 : 0.03);
    sugPrice   = roundUpCustomerFriendlyPrice(price * (1 + raiseRate));
    action     = 'TANG_GIA';
    reason     = `${orders7d} đơn/7 ngày, nhưng margin ${marginPct.toFixed(1)}% dưới mục tiêu. Tăng ${(raiseRate * 100).toFixed(0)}% → ${fmtPrice(sugPrice)}. [COMBO_V4_10PCT_CAP_CLEAN_PENDING]`;
    confidence = 80;
  } else if (views7d > 800 && cvrPct < 1.0 && dropOk) {
    action     = 'GIAM_GIA';
    sugPrice   = dropPrice;
    reason     = `${views7d.toLocaleString()} views/7 ngày nhưng CVR ${cvrPct.toFixed(2)}%. Giảm ${(GIAM_GIA_DROP * 100).toFixed(0)}% → ${fmtPrice(dropPrice)}, margin sau giảm ${(dropMargin * 100).toFixed(1)}%. [COMBO_V4_10PCT_CAP_CLEAN_PENDING]`;
    confidence = 72;
  } else if (views7d > 800 && cvrPct < 1.0 && !dropOk) {
    action     = 'GIU_GIA';
    reason     = `${views7d.toLocaleString()} views/7 ngày, CVR ${cvrPct.toFixed(2)}% thấp. Không giảm giá vì margin ${marginPct.toFixed(1)}% sát đáy. Test lại ảnh/nội dung. [COMBO_V4_10PCT_CAP_CLEAN_PENDING]`;
    confidence = 65;
  } else if (orders30d === 0) {
    action     = 'KILL_SKU';
    reason     = `0 đơn trong 30 ngày. Không thể gom combo đạt giảm ≥10%. Đề nghị xoá khỏi danh mục. [COMBO_V4_10PCT_CAP_CLEAN_PENDING]`;
    confidence = 85;
  } else {
    action     = 'GIU_GIA';
    reason     = `SKU ổn. Margin ${marginPct.toFixed(1)}%, ${orders7d} đơn/7 ngày. Giữ giá ${fmtPrice(price)}. [COMBO_V4_10PCT_CAP_CLEAN_PENDING]`;
    confidence = 65;
  }

  // Ads logic
  let adsAction = 'GIU_NGUYEN';
  let adsNote   = '';
  if (adsSpend7d > 0 && orders7d === 0) {
    adsAction = 'NGUNG_ADS'; adsNote = `Chi ${fmtPrice(adsSpend7d)} ads/7 ngày, 0 đơn. Dừng ngay.`;
  } else if (margin < 0 && adsSpend7d > 0) {
    adsAction = 'NGUNG_ADS'; adsNote = `Đang lỗ và vẫn chạy ads ${fmtPrice(adsSpend7d)}/7 ngày. Dừng ngay.`;
  } else if (roas >= 3 && margin >= targetMargin && orders7d >= 5) {
    adsAction = 'CHAY_ADS'; adsNote = `ROAS ${roas.toFixed(1)}, margin ${marginPct.toFixed(1)}%, ${orders7d} đơn/7 ngày. Scale ads.`;
  } else if (views7d > 800 && cvrPct < 1.0 && adsSpend7d > 0) {
    adsAction = 'TEST_LAI_GIA_VA_CONTENT'; adsNote = `Ads chạy nhưng CVR ${cvrPct.toFixed(2)}%. Test lại giá/ảnh.`;
  } else if (adsSpend7d === 0 && orders7d > 10 && margin >= targetMargin) {
    adsAction = 'CHAY_ADS'; adsNote = `${orders7d} đơn organic, margin ${marginPct.toFixed(1)}%. Thử scale ads.`;
  }

  if (adsNote) reason += `\n\n[Ads] ${adsNote}`;

  return {
    sku:                 product.sku,
    current_price:       price,
    current_profit:      Math.round(profit),
    current_margin:      parseFloat(marginPct.toFixed(2)),
    suggested_action:    action,
    suggested_price:     sugPrice || undefined,
    suggested_combo_qty: comboQty || undefined,
    ads_action:          adsAction,
    reason,
    confidence,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user   = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body     = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const offset   = toNumber(body.offset, 0);
    const limit    = Math.min(toNumber(body.limit, 10), 10); // max 10 per batch
    const recDate  = body.rec_date || new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Load only this batch of active products
    const products = await withRetry(() =>
      base44.asServiceRole.entities.Product.filter(
        { status: 'active' },
        '-updated_date',
        limit,
        offset
      )
    );

    const has_more    = products.length === limit;
    const next_offset = offset + products.length;

    let created = 0, updated = 0, failed = 0;
    const errors = [];

    for (const product of products) {
      try {
        // Load perf for this SKU only
        const perfData = await withRetry(() =>
          base44.asServiceRole.entities.DailyPerformance.filter(
            { sku: product.sku },
            '-date',
            30
          )
        );
        await sleep(REQUEST_DELAY_MS);

        const s = runPriceOptimizer(product, perfData);

        const payload = {
          sku:                 s.sku,
          rec_date:            recDate,
          current_price:       s.current_price,
          current_profit:      s.current_profit,
          current_margin:      s.current_margin,
          suggested_action:    s.suggested_action,
          suggested_price:     s.suggested_price,
          suggested_combo_qty: s.suggested_combo_qty,
          ads_action:          s.ads_action,
          reason:              s.reason,
          confidence:          s.confidence,
          status:              'pending',
        };

        // Find existing pending suggestions for this SKU
        const existingList = await withRetry(() =>
          base44.asServiceRole.entities.AISuggestion.filter(
            { sku: product.sku, status: 'pending' },
            '-rec_date',
            10
          )
        );
        await sleep(REQUEST_DELAY_MS);

        if (existingList.length > 0) {
          // Update the most recent one
          await withRetry(() =>
            base44.asServiceRole.entities.AISuggestion.update(existingList[0].id, payload)
          );
          updated += 1;

          // Delete older duplicates (up to 2)
          const toDelete = existingList.slice(1, 3);
          for (const dup of toDelete) {
            await withRetry(() =>
              base44.asServiceRole.entities.AISuggestion.delete(dup.id)
            );
            await sleep(REQUEST_DELAY_MS);
          }
        } else {
          await withRetry(() =>
            base44.asServiceRole.entities.AISuggestion.create(payload)
          );
          created += 1;
        }
      } catch (err) {
        failed += 1;
        errors.push(`${product.sku}: ${err?.message || String(err)}`);
      }

      await sleep(REQUEST_DELAY_MS);
    }

    return Response.json({
      success:     true,
      processed:   products.length,
      created,
      updated,
      failed,
      offset,
      next_offset,
      has_more,
      limit,
      rec_date:    recDate,
      errors:      errors.slice(0, 20),
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});