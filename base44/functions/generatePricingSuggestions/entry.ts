import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DEFAULT_FEE_RATE = 0.22;
const FIXED_COST = 15833;
const TARGET_MARGIN = { moi: 0.02, core: 0.07, upsell: 0.13 };
const GIAM_GIA_MARGIN_FLOOR = 0.10;
const GIAM_GIA_DROP_RATE = 0.04;

const ENTITY_LOAD_LIMIT = 5000;
const REQUEST_DELAY_MS = 250;
const RATE_LIMIT_RETRIES = 5;

const MIN_COMBO_UNIT_DISCOUNT = 0.10;
const MIN_COMPANY_MARGIN = 0.05;
const COMBO_VERSION_TAG = '[COMBO_V3_10PCT_CAP]';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('rate limit') || message.includes('too many requests') || message.includes('429');
}

async function withRateLimitRetry(operation) {
  let lastError;
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt === RATE_LIMIT_RETRIES) break;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError;
}

function normalizeSku(sku) {
  return String(sku || '').trim().toUpperCase();
}

function scoreRecord(record) {
  return new Date(record?.updated_date || record?.created_date || 0).getTime() || 0;
}

function uniqueProductsBySku(products) {
  const bySku = new Map();
  for (const product of products || []) {
    const key = normalizeSku(product?.sku);
    if (!key) continue;
    const existing = bySku.get(key);
    if (!existing || scoreRecord(product) > scoreRecord(existing)) {
      bySku.set(key, product);
    }
  }
  return [...bySku.values()];
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundUpCustomerFriendlyPrice(price) {
  const safePrice = toNumber(price);
  if (safePrice <= 0) return 0;
  const step = safePrice >= 100000 ? 1000 : 500;
  const ceiling = Math.ceil(safePrice / step) * step;
  const charmPrice = ceiling - 100;
  return charmPrice >= safePrice ? charmPrice : ceiling;
}

function suggestMinimumProfitablePrice(cost, feeRate, fixedCost, minMargin = MIN_COMPANY_MARGIN) {
  const denominator = 1 - feeRate - minMargin;
  if (denominator <= 0) return 0;
  return roundUpCustomerFriendlyPrice((cost + fixedCost) / denominator);
}

function clampProfitablePrice(price, minPrice, maxPrice) {
  const lower = toNumber(minPrice, 0);
  const safePrice = Math.max(Math.round(toNumber(price)), lower);
  const upper = Number(maxPrice);
  if (Number.isFinite(upper) && upper >= safePrice) {
    return Math.min(safePrice, upper);
  }
  return safePrice;
}

function getComboQtyCap(unitPrice) {
  return toNumber(unitPrice) > 40000 ? 12 : 24;
}

function suggestDiscountCombo(product) {
  const cost = toNumber(product?.cost);
  const currentPrice = toNumber(product?.current_price ?? product?.price);
  const currentComboQty = Math.max(1, toNumber(product?.combo_qty, 1));
  const currentUnitPrice = currentComboQty > 0 ? currentPrice / currentComboQty : currentPrice;
  const feeRate = toNumber(product?.shopee_fee_rate, DEFAULT_FEE_RATE);
  const fixedCost =
    toNumber(product?.ops_fee, 3000) +
    toNumber(product?.packing_fee, 11000) +
    toNumber(product?.fixed_fee, 1833);

  const minMargin = MIN_COMPANY_MARGIN;
  const minPrice = toNumber(product?.min_price, 0);
  const maxPrice = product?.max_price;
  const cap = getComboQtyCap(currentUnitPrice);

  function candidateFor(qty) {
    const rawPrice = suggestMinimumProfitablePrice(cost * qty, feeRate, fixedCost, minMargin);
    const upper = Number(maxPrice);
    const price =
      Number.isFinite(upper) && upper >= rawPrice
        ? clampProfitablePrice(rawPrice, minPrice, upper)
        : Math.max(rawPrice, minPrice);

    const unitPrice = qty > 0 ? price / qty : price;
    const discountRate = currentUnitPrice > 0 ? (currentUnitPrice - unitPrice) / currentUnitPrice : 0;
    const netRev = price * (1 - feeRate);
    const profit = netRev - cost * qty - fixedCost;
    const margin = price > 0 ? profit / price : 0;

    return {
      qty,
      price,
      unitPrice,
      discountRate,
      profit,
      margin,
      cap,
      qualified:
        qty <= cap &&
        discountRate >= MIN_COMBO_UNIT_DISCOUNT &&
        margin >= minMargin &&
        price > 0,
    };
  }

  const candidates = [];
  for (let q = 2; q <= cap; q += 1) {
    candidates.push(candidateFor(q));
  }

  const viable = candidates.filter(c => c.qualified);
  if (viable.length === 0) return null;

  viable.sort((a, b) => a.qty - b.qty || a.price - b.price);
  return viable[0];
}

function fmtPrice(n) {
  return `₫${Math.round(n).toLocaleString('vi-VN')}`;
}

function fmtPct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function runPriceOptimizer({ product, perf7, perf30 }) {
  const price = toNumber(product.current_price ?? product.price);
  const cost = toNumber(product.cost);
  const feeRate = toNumber(product.shopee_fee_rate, DEFAULT_FEE_RATE);
  const role = product.sku_role || 'core';
  const targetMargin = TARGET_MARGIN[role] ?? TARGET_MARGIN.core;

  const currentComboQty = Math.max(1, toNumber(product.combo_qty, 1));
  const netRevenue = price * (1 - feeRate);
  const profit = netRevenue - cost * currentComboQty - FIXED_COST;
  const margin = price > 0 ? profit / price : 0;
  const marginPct = margin * 100;

  const orders7d = perf7.reduce((s, r) => s + toNumber(r.orders), 0);
  const orders30d = perf30.reduce((s, r) => s + toNumber(r.orders), 0);
  const views7d = perf7.reduce((s, r) => s + toNumber(r.views), 0);
  const adsSpend7d = perf7.reduce((s, r) => s + toNumber(r.ads_spend), 0);
  const revenue7d = perf7.reduce((s, r) => s + toNumber(r.revenue), 0);
  const latestPerf = perf7[0] || {};
  const cvr = toNumber(latestPerf.conversion_rate);
  const cvrPct = cvr * 100;
  const roas = adsSpend7d > 0 ? revenue7d / adsSpend7d : 0;

  const minRetailDenom = 1 - feeRate - targetMargin;
  const suggestedBasePrice = minRetailDenom > 0
    ? roundUpCustomerFriendlyPrice((cost * currentComboQty + FIXED_COST) / minRetailDenom)
    : 0;

  const comboBest = suggestDiscountCombo(product);

  const dropPrice = Math.floor((price * (1 - GIAM_GIA_DROP_RATE)) / 1000) * 1000;
  const dropNetRevenue = dropPrice * (1 - feeRate);
  const dropProfit = dropNetRevenue - cost * currentComboQty - FIXED_COST;
  const dropMargin = dropPrice > 0 ? dropProfit / dropPrice : 0;
  const dropIsAcceptable = dropMargin >= GIAM_GIA_MARGIN_FLOOR;

  let suggestedAction = 'GIU_GIA';
  let suggestedPrice = null;
  let suggestedComboQty = null;
  let reason = '';
  let confidence = 60;

  if (margin < 0) {
    if (comboBest?.qualified) {
      suggestedAction = 'GOM_COMBO';
      suggestedPrice = comboBest.price;
      suggestedComboQty = comboBest.qty;
      reason = `${COMBO_VERSION_TAG} Lỗ ${fmtPct(-margin)} mỗi đơn (${fmtPrice(profit)}/đơn). Gom ${comboBest.qty} sản phẩm → giá combo ${fmtPrice(comboBest.price)} (đơn giá ${fmtPrice(comboBest.unitPrice)}, giảm ${fmtPct(comboBest.discountRate)} so với lẻ). Margin combo ${fmtPct(comboBest.margin)} ≥ 5%, giới hạn combo tối đa ${comboBest.cap}.`;
      confidence = 88;
    } else {
      suggestedAction = 'TANG_GIA';
      suggestedPrice = suggestedBasePrice;
      reason = `${COMBO_VERSION_TAG} Lỗ ${fmtPct(-margin)} mỗi đơn (${fmtPrice(profit)}/đơn). Không có combo hợp lệ đạt đồng thời giảm đơn giá ≥10%, margin ≥5%, và không vượt giới hạn 12/24 sản phẩm. Cần tăng giá lên ${fmtPrice(suggestedBasePrice)}.`;
      confidence = 90;
    }
  } else if (comboBest?.qualified) {
    suggestedAction = 'GOM_COMBO';
    suggestedPrice = comboBest.price;
    suggestedComboQty = comboBest.qty;
    reason = `${COMBO_VERSION_TAG} Gom ${comboBest.qty} sản phẩm → giá combo ${fmtPrice(comboBest.price)} (đơn giá ${fmtPrice(comboBest.unitPrice)}, rẻ hơn ${fmtPct(comboBest.discountRate)} so với giá lẻ ${fmtPrice(price)}). Margin combo ${fmtPct(comboBest.margin)} ≥ 5%, giới hạn combo tối đa ${comboBest.cap}.`;
    confidence = 84;
  } else if (orders7d > 15 && margin < targetMargin) {
    const raiseRate = margin < 0.02 ? 0.10 : margin < 0.05 ? 0.06 : 0.03;
    suggestedPrice = roundUpCustomerFriendlyPrice(price * (1 + raiseRate));
    suggestedAction = 'TANG_GIA';
    reason = `${orders7d} đơn/7 ngày cho thấy nhu cầu tốt, nhưng margin ${marginPct.toFixed(1)}% dưới mục tiêu ${(targetMargin * 100).toFixed(0)}%. Tăng ${(raiseRate * 100).toFixed(0)}% lên ${fmtPrice(suggestedPrice)}.`;
    confidence = 80;
  } else if (views7d > 800 && cvrPct < 1.0 && dropIsAcceptable) {
    suggestedAction = 'GIAM_GIA';
    suggestedPrice = dropPrice;
    reason = `${views7d.toLocaleString()} lượt xem/7 ngày nhưng CVR chỉ ${cvrPct.toFixed(2)}%. Giảm ${(GIAM_GIA_DROP_RATE * 100).toFixed(0)}% → ${fmtPrice(dropPrice)}, margin sau giảm ${(dropMargin * 100).toFixed(1)}% vẫn trên ngưỡng an toàn 10%.`;
    confidence = 72;
  } else if (views7d > 800 && cvrPct < 1.0 && !dropIsAcceptable) {
    suggestedAction = 'GIU_GIA';
    reason = `${views7d.toLocaleString()} lượt xem/7 ngày nhưng CVR ${cvrPct.toFixed(2)}% thấp. Không giảm giá vì margin ${marginPct.toFixed(1)}% quá sát đáy. Cần test lại ảnh/nội dung.`;
    confidence = 65;
  } else if (orders30d === 0) {
    if (comboBest?.qualified) {
      suggestedAction = 'GOM_COMBO';
      suggestedPrice = comboBest.price;
      suggestedComboQty = comboBest.qty;
      reason = `${COMBO_VERSION_TAG} 0 đơn hàng trong 30 ngày. Thử gom ${comboBest.qty} sản phẩm → giá combo ${fmtPrice(comboBest.price)} (đơn giá ${fmtPrice(comboBest.unitPrice)}, giảm ${fmtPct(comboBest.discountRate)}). Nếu combo cũng không có đơn sau 14 ngày → Kill SKU.`;
      confidence = 74;
    } else {
      suggestedAction = 'KILL_SKU';
      reason = `${COMBO_VERSION_TAG} 0 đơn hàng trong 30 ngày. Không thể gom combo với mức giảm ≥10%, margin ≥5%, và giới hạn 12/24 sản phẩm. Đề nghị xoá khỏi danh mục.`;
      confidence = 85;
    }
  } else {
    suggestedAction = 'GIU_GIA';
    reason = `SKU hoạt động ổn. Margin ${marginPct.toFixed(1)}%, ${orders7d} đơn/7 ngày, ${orders30d} đơn/30 ngày. Giữ giá ${fmtPrice(price)}.`;
    confidence = 65;
  }

  let adsAction = 'GIU_NGUYEN';
  let adsReason = '';

  if (adsSpend7d > 0 && orders7d === 0) {
    adsAction = 'NGUNG_ADS';
    adsReason = `Chi ${fmtPrice(adsSpend7d)} ads/7 ngày nhưng 0 đơn hàng. ROAS = 0. Dừng ads ngay.`;
  } else if (margin < 0 && adsSpend7d > 0) {
    adsAction = 'NGUNG_ADS';
    adsReason = `Đang lỗ ${fmtPct(-margin)}/đơn và vẫn đang chạy ads ${fmtPrice(adsSpend7d)}/7 ngày. Dừng ngay.`;
  } else if (roas >= 3 && margin >= targetMargin && orders7d >= 5) {
    adsAction = 'CHAY_ADS';
    adsReason = `ROAS = ${roas.toFixed(1)}, margin ${marginPct.toFixed(1)}%, ${orders7d} đơn/7 ngày. Có thể tăng ngân sách.`;
  } else if (views7d > 800 && cvrPct < 1.0 && adsSpend7d > 0) {
    adsAction = 'TEST_LAI_GIA_VA_CONTENT';
    adsReason = `Ads đang chạy nhưng CVR chỉ ${cvrPct.toFixed(2)}%. Test lại giá/ảnh chính/tiêu đề.`;
  } else if (adsSpend7d === 0 && orders7d > 10 && margin >= targetMargin) {
    adsAction = 'CHAY_ADS';
    adsReason = `SKU có ${orders7d} đơn/7 ngày organic và margin tốt. Thử chạy ads để scale.`;
  }

  const fullReason = adsReason ? `${reason}\n\n[Ads] ${adsReason}` : reason;

  return {
    sku: product.sku,
    current_price: price,
    current_profit: Math.round(profit),
    current_margin: parseFloat(marginPct.toFixed(2)),
    suggested_action: suggestedAction,
    suggested_price: suggestedPrice,
    suggested_combo_qty: suggestedComboQty,
    ads_action: adsAction,
    reason: fullReason,
    confidence,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const recDate = body?.rec_date || new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const today = recDate;

    const offset = Math.max(0, toNumber(body?.offset, 0));
const limit = Math.max(1, Math.min(25, toNumber(body?.limit, DEFAULT_BATCH_LIMIT)));
    const productsRaw = await base44.asServiceRole.entities.Product.list(
  '-updated_date',
  limit,
  offset
);

const products = uniqueProductsBySku(productsRaw)
  .filter(product => product.status === 'active');

if (!Array.isArray(productsRaw) || productsRaw.length === 0) {
  return Response.json({
    success: true,
    version: COMBO_VERSION_TAG,
    processed: 0,
    created: 0,
    updated: 0,
    failed: 0,
    total_products_loaded: 0,
    offset,
    next_offset: offset,
    has_more: false,
    limit,
    today,
  });
}

    const allPerf = await base44.asServiceRole.entities.DailyPerformance.list('-date', 5000);
    const perfBySku = {};
    for (const r of allPerf) {
      const key = normalizeSku(r.sku);
      if (!perfBySku[key]) perfBySku[key] = [];
      perfBySku[key].push(r);
    }

    const existingToday = await base44.asServiceRole.entities.AISuggestion.filter(
      { rec_date: today },
      '-rec_date',
      ENTITY_LOAD_LIMIT
    );

    const existingBySkuMap = {};
    for (const s of existingToday) {
      existingBySkuMap[normalizeSku(s.sku)] = s;
    }

    let created = 0;
    let updated = 0;
    let failed = 0;
    const errors = [];

    for (const product of products) {
      try {
        const skuKey = normalizeSku(product.sku);
        const perfData = (perfBySku[skuKey] || []).sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const perf7 = perfData.slice(0, 7);
        const perf30 = perfData.slice(0, 30);

        const s = runPriceOptimizer({ product, perf7, perf30 });

        const payload = {
          sku: s.sku,
          rec_date: today,
          current_price: s.current_price,
          current_profit: s.current_profit,
          current_margin: s.current_margin,
          suggested_action: s.suggested_action,
          suggested_price: s.suggested_price || undefined,
          suggested_combo_qty: s.suggested_combo_qty || undefined,
          ads_action: s.ads_action,
          reason: s.reason,
          confidence: s.confidence,
          status: 'pending',
        };

        const existing = existingBySkuMap[skuKey];
        if (existing) {
          await withRateLimitRetry(() =>
            base44.asServiceRole.entities.AISuggestion.update(existing.id, payload)
          );
          updated += 1;
        } else {
          await withRateLimitRetry(() =>
            base44.asServiceRole.entities.AISuggestion.create(payload)
          );
          created += 1;
        }
      } catch (error) {
        failed += 1;
        errors.push(`${product.sku}: ${error?.message || String(error)}`);
      }

      await sleep(REQUEST_DELAY_MS);
    }

    return Response.json({
      success: true,
      version: COMBO_VERSION_TAG,
      total_products_loaded: productsRaw.length,
      processed: products.length,
      created,
      updated,
      failed,
      today,
      errors: errors.slice(0, 20),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
