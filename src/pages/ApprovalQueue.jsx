import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  CheckCircle2, XCircle, Eye, TestTube, AlertTriangle,
  Skull, TrendingUp, TrendingDown, Layers, Zap,
  Megaphone, MegaphoneOff, RefreshCw, ChevronDown, ChevronUp
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';

const ACTION_CONFIG = {
  GIU_GIA:   { label: 'GIỮ GIÁ',   cls: 'bg-blue-100 text-blue-800 border-blue-200',     icon: null,         priority: 4 },
  TANG_GIA:  { label: 'TĂNG GIÁ',  cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', icon: TrendingUp,  priority: 1 },
  GIAM_GIA:  { label: 'GIẢM GIÁ',  cls: 'bg-red-100 text-red-800 border-red-200',         icon: TrendingDown, priority: 3 },
  GOM_COMBO: { label: 'GOM COMBO', cls: 'bg-purple-100 text-purple-800 border-purple-200', icon: Layers,       priority: 2 },
  KILL_SKU:  { label: 'KILL SKU',  cls: 'bg-gray-200 text-gray-700 border-gray-300',       icon: Skull,        priority: 3 },
};

const ADS_CONFIG = {
  GIU_NGUYEN:              { label: 'GIỮ NGUYÊN',        cls: 'bg-muted text-muted-foreground',  icon: null },
  CHAY_ADS:                { label: 'CHẠY ADS',          cls: 'bg-orange-100 text-orange-800',   icon: Megaphone },
  NGUNG_ADS:               { label: 'NGỪNG ADS',         cls: 'bg-yellow-100 text-yellow-800',   icon: MegaphoneOff },
  TEST_LAI_GIA_VA_CONTENT: { label: 'TEST LẠI NỘI DUNG', cls: 'bg-violet-100 text-violet-800',   icon: RefreshCw },
};

// Sort: losing first, then by action priority, then by confidence desc
function sortItems(items) {
  return [...items].sort((a, b) => {
    const aLosing = (a.current_profit != null && a.current_profit < 0) ? 0 : 1;
    const bLosing = (b.current_profit != null && b.current_profit < 0) ? 0 : 1;
    if (aLosing !== bLosing) return aLosing - bLosing;
    const ap = (ACTION_CONFIG[a.suggested_action] || {}).priority || 9;
    const bp = (ACTION_CONFIG[b.suggested_action] || {}).priority || 9;
    if (ap !== bp) return ap - bp;
    return (b.confidence || 0) - (a.confidence || 0);
  });
}

function ConfidenceBar({ value }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const pct = Math.min(100, Math.max(0, value));
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 65 ? 'bg-yellow-500' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold tabular-nums">{pct}%</span>
    </div>
  );
}

function ReasonBlock({ text }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const lines = text.split('\n').filter(Boolean);
  const preview = lines[0];
  const hasMore = lines.length > 1 || preview.length > 160;
  return (
    <div className="bg-muted/40 border border-border/50 rounded-lg px-4 py-3">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Phân tích hệ thống</p>
      <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
        {expanded ? text : (hasMore ? preview.slice(0, 160) + (preview.length > 160 ? '...' : '') : text)}
      </p>
      {hasMore && (
        <button onClick={() => setExpanded(e => !e)} className="mt-1 flex items-center gap-1 text-xs text-primary font-medium hover:underline">
          {expanded ? <><ChevronUp className="w-3 h-3" />Thu gọn</> : <><ChevronDown className="w-3 h-3" />Xem đầy đủ</>}
        </button>
      )}
    </div>
  );
}

function DetailModal({ item, onClose }) {
  if (!item) return null;
  const actionCfg = ACTION_CONFIG[item.suggested_action] || {};
  const adsCfg    = ADS_CONFIG[item.ads_action] || {};
  const priceDelta = item.suggested_price && item.current_price
    ? parseFloat(item.suggested_price) - parseFloat(item.current_price) : null;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Chi tiết phân tích — <span className="font-mono">{item.sku}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[
              { label: 'Ngày', value: item.rec_date },
              { label: 'Giá hiện tại', value: item.current_price ? `₫${parseFloat(item.current_price).toLocaleString()}` : '—' },
              { label: 'Lợi nhuận/đơn', value: item.current_profit != null
                  ? <span className={cn('font-bold', item.current_profit < 0 ? 'text-red-600' : 'text-emerald-600')}>
                      ₫{parseFloat(item.current_profit).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}
                    </span> : '—' },
              { label: 'Margin', value: item.current_margin != null
                  ? <span className={cn('font-bold', item.current_margin < 0 ? 'text-red-600' : 'text-emerald-600')}>
                      {parseFloat(item.current_margin).toFixed(2)}%
                    </span> : '—' },
              { label: 'Hành động', value: <span className={cn('text-xs font-bold px-2 py-1 rounded-md border', actionCfg.cls)}>{actionCfg.label || item.suggested_action}</span> },
              { label: 'Giá đề xuất', value: item.suggested_price
                  ? <span className="font-mono font-bold text-primary">
                      ₫{parseFloat(item.suggested_price).toLocaleString()}
                      {priceDelta !== null && <span className={cn('text-xs ml-1.5', priceDelta > 0 ? 'text-emerald-600' : 'text-red-500')}>
                        ({priceDelta > 0 ? '+' : ''}{((priceDelta / parseFloat(item.current_price)) * 100).toFixed(1)}%)
                      </span>}
                    </span> : '—' },
              { label: 'Combo Qty', value: item.suggested_combo_qty ? <span className="font-bold text-purple-700">{item.suggested_combo_qty} đơn</span> : '—' },
              { label: 'Ads', value: item.ads_action ? <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', adsCfg.cls)}>{adsCfg.label}</span> : '—' },
              { label: 'Confidence', value: <ConfidenceBar value={item.confidence} /> },
              { label: 'Trạng thái', value: item.status },
            ].map(({ label, value }) => (
              <div key={label} className="bg-muted/30 rounded-lg px-3 py-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
                <div>{value}</div>
              </div>
            ))}
          </div>
          {item.reason && (
            <div className="bg-muted/40 rounded-lg px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Phân tích đầy đủ</p>
              <p className="text-sm leading-relaxed whitespace-pre-line">{item.reason}</p>
            </div>
          )}
          {item.admin_note && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
              <p className="text-xs font-semibold text-blue-700 mb-1">Ghi chú admin</p>
              <p className="text-sm">{item.admin_note}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ApprovalQueue() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState({});
  const [detailItem, setDetailItem] = useState(null);
  const [noteMap, setNoteMap] = useState({});
  const [running, setRunning] = useState(false);

  const load = () => {
    setLoading(true);
    base44.entities.AISuggestion.filter({ status: 'pending' }, '-rec_date', 5000)
      .then(d => { setItems(sortItems(d)); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const setProc = (id, v) => setProcessing(p => ({ ...p, [id]: v }));

  const runAI = async () => {
    setRunning(true);
    let offset = 0;
    const limit = 10;
    let totalProcessed = 0, totalCreated = 0, totalUpdated = 0;
    try {
      while (true) {
        const res = await base44.functions.invoke('generatePricingSuggestions', { offset, limit });
        const d = res.data || {};
        totalProcessed += d.processed || 0;
        totalCreated   += d.created || 0;
        totalUpdated   += d.updated || 0;
        if (!d.has_more) break;
        offset = d.next_offset;
      }
      toast.success(`AI xong! ${totalProcessed} SKUs xử lý — ${totalCreated} mới, ${totalUpdated} cập nhật.`);
      load();
    } catch (e) {
      toast.error('Phân tích thất bại: ' + e.message);
    } finally {
      setRunning(false);
    }
  };

  const approveSuggestion = async (item) => {
    setProc(item.id, true);
    await base44.entities.AISuggestion.update(item.id, { status: 'approved', admin_note: noteMap[item.id] || undefined });
    toast.success(`Đã duyệt — ${item.sku}`);
    setItems(prev => prev.filter(i => i.id !== item.id));
    setProc(item.id, false);
  };

  const rejectSuggestion = async (item) => {
    setProc(item.id, true);
    await base44.entities.AISuggestion.update(item.id, { status: 'rejected', admin_note: noteMap[item.id] || undefined });
    toast.success(`Đã từ chối — ${item.sku}`);
    setItems(prev => prev.filter(i => i.id !== item.id));
    setProc(item.id, false);
  };

  const startPriceTest = async (item) => {
    if (!item.suggested_price) { toast.error('Cần có giá đề xuất để tạo price test'); return; }
    setProc(item.id, true);
    await base44.entities.PriceTestLog.create({
      sku: item.sku,
      old_price: item.current_price,
      test_price: item.suggested_price,
      test_start_date: format(new Date(), 'yyyy-MM-dd'),
      status: 'running',
      result_note: `${item.suggested_action} — ${(item.reason || '').slice(0, 300)}`,
    });
    await base44.entities.AISuggestion.update(item.id, { status: 'testing', admin_note: noteMap[item.id] || 'Test giá 7 ngày' });
    toast.success(`Price test tạo — ${item.sku}: ${fmtP(item.current_price)} → ${fmtP(item.suggested_price)}`);
    setItems(prev => prev.filter(i => i.id !== item.id));
    setProc(item.id, false);
  };

  const markKilled = async (item) => {
    setProc(item.id, true);
    const products = await base44.entities.Product.filter({ sku: item.sku });
    if (products.length > 0) await base44.entities.Product.update(products[0].id, { status: 'killed' });
    await base44.entities.AISuggestion.update(item.id, { status: 'approved', admin_note: noteMap[item.id] || 'SKU đã kill' });
    toast.success(`SKU ${item.sku} đã KILL`);
    setItems(prev => prev.filter(i => i.id !== item.id));
    setProc(item.id, false);
  };

  function fmtP(v) { return v ? `₫${parseFloat(v).toLocaleString()}` : '—'; }

  const losingCount = items.filter(i => i.current_profit != null && i.current_profit < 0).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Price Approval Queue"
        subtitle={
          <span>
            <span className="font-semibold text-foreground">{items.length}</span> gợi ý chờ duyệt
            {losingCount > 0 && <span className="ml-2 text-red-600 font-semibold">· {losingCount} đang lỗ</span>}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5 font-medium text-orange-700 hidden sm:block">
              ⚠ Không tự động push lên Shopee — admin phải duyệt thủ công
            </span>
            <Button size="sm" onClick={runAI} disabled={running} className="gap-1.5 font-semibold">
              {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              {running ? 'Đang phân tích...' : 'Chạy AI'}
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {loading ? (
          Array(3).fill(0).map((_, i) => <div key={i} className="bg-card border border-border rounded-xl p-5 animate-pulse h-44" />)
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
            <CheckCircle2 className="w-12 h-12 opacity-20" />
            <p className="font-semibold text-base">Không có gợi ý nào chờ duyệt</p>
            <Button size="sm" onClick={runAI} disabled={running} className="gap-1.5">
              <Zap className="w-3.5 h-3.5" />Chạy phân tích AI ngay
            </Button>
          </div>
        ) : items.map(item => {
          const actionCfg = ACTION_CONFIG[item.suggested_action] || {};
          const adsCfg    = ADS_CONFIG[item.ads_action] || {};
          const isLosing  = item.current_profit != null && item.current_profit < 0;
          const isKill    = item.suggested_action === 'KILL_SKU';
          const isCombo   = item.suggested_action === 'GOM_COMBO';
          const isTang    = item.suggested_action === 'TANG_GIA';
          const priceDelta = item.suggested_price && item.current_price
            ? parseFloat(item.suggested_price) - parseFloat(item.current_price) : null;
          const disabled = processing[item.id];
          const ActionIcon = actionCfg.icon;

          return (
            <div key={item.id} className={cn(
              'bg-card border rounded-xl overflow-hidden transition-shadow hover:shadow-sm',
              isLosing ? 'border-red-300' : isKill ? 'border-gray-300' : isCombo ? 'border-purple-200' : isTang ? 'border-emerald-200' : 'border-border'
            )}>
              {/* Priority strip */}
              {isLosing && (
                <div className="bg-red-600 text-white text-[10px] font-bold px-4 py-1 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" />
                  ĐANG LỖ — XỬ LÝ NGAY — lợi nhuận {fmtP(item.current_profit)}/đơn
                </div>
              )}

              <div className="p-5 space-y-3">
                {/* Header row */}
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-mono font-bold text-base tracking-wide">{item.sku}</span>

                    <span className={cn('inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-md border', actionCfg.cls)}>
                      {ActionIcon && <ActionIcon className="w-3 h-3" />}
                      {actionCfg.label || item.suggested_action}
                    </span>

                    {item.ads_action && item.ads_action !== 'GIU_NGUYEN' && (
                      <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full', adsCfg.cls)}>
                        {adsCfg.icon && <adsCfg.icon className="w-2.5 h-2.5" />}
                        {adsCfg.label}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{item.rec_date}</span>
                    <ConfidenceBar value={item.confidence} />
                  </div>
                </div>

                {/* Metrics */}
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <div>
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Giá hiện tại</p>
                    <p className="font-mono font-bold text-sm">{fmtP(item.current_price)}</p>
                  </div>

                  {item.current_profit != null && (
                    <div>
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Lợi nhuận/đơn</p>
                      <p className={cn('font-mono font-bold text-sm', item.current_profit < 0 ? 'text-red-600' : 'text-emerald-600')}>
                        {item.current_profit < 0 ? '' : '+'}{parseFloat(item.current_profit).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}đ
                      </p>
                    </div>
                  )}

                  {item.current_margin != null && (
                    <div>
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Margin</p>
                      <p className={cn('font-bold text-sm', item.current_margin < 0 ? 'text-red-600' : item.current_margin < 5 ? 'text-yellow-600' : 'text-emerald-600')}>
                        {parseFloat(item.current_margin).toFixed(1)}%
                      </p>
                    </div>
                  )}

                  {item.suggested_price && (
                    <div>
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Giá đề xuất</p>
                      <div className="flex items-baseline gap-1.5">
                        <p className="font-mono font-bold text-sm text-primary">{fmtP(item.suggested_price)}</p>
                        {priceDelta !== null && (
                          <span className={cn('text-xs font-semibold', priceDelta > 0 ? 'text-emerald-600' : 'text-red-500')}>
                            {priceDelta > 0 ? '+' : ''}{((priceDelta / parseFloat(item.current_price)) * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {item.suggested_combo_qty && (
                    <div>
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Combo</p>
                      <p className="font-bold text-purple-700 text-sm">{item.suggested_combo_qty} đơn</p>
                    </div>
                  )}
                </div>

                {/* Reason */}
                <ReasonBlock text={item.reason} />

                {/* Admin note */}
                <Textarea
                  placeholder="Ghi chú admin (tuỳ chọn)..."
                  className="text-xs h-10 resize-none"
                  value={noteMap[item.id] || ''}
                  onChange={e => setNoteMap(m => ({ ...m, [item.id]: e.target.value }))}
                />

                {/* Action buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" disabled={disabled}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5"
                    onClick={() => approveSuggestion(item)}>
                    <CheckCircle2 className="w-3.5 h-3.5" />Duyệt
                  </Button>

                  <Button size="sm" variant="outline" disabled={disabled}
                    className="border-red-200 text-red-600 hover:bg-red-50 font-semibold gap-1.5"
                    onClick={() => rejectSuggestion(item)}>
                    <XCircle className="w-3.5 h-3.5" />Từ Chối
                  </Button>

                  {item.suggested_price && (
                    <Button size="sm" variant="outline" disabled={disabled}
                      className="border-blue-200 text-blue-700 hover:bg-blue-50 font-semibold gap-1.5"
                      onClick={() => startPriceTest(item)}>
                      <TestTube className="w-3.5 h-3.5" />Test Giá 7 Ngày
                    </Button>
                  )}

                  {isKill && (
                    <Button size="sm" variant="outline" disabled={disabled}
                      className="border-gray-300 text-gray-700 hover:bg-gray-100 font-semibold gap-1.5"
                      onClick={() => markKilled(item)}>
                      <Skull className="w-3.5 h-3.5" />Kill SKU
                    </Button>
                  )}

                  <Button size="sm" variant="ghost" disabled={disabled}
                    className="text-muted-foreground gap-1.5 ml-auto"
                    onClick={() => setDetailItem(item)}>
                    <Eye className="w-3.5 h-3.5" />Chi Tiết
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <DetailModal item={detailItem} onClose={() => setDetailItem(null)} />
    </div>
  );
}