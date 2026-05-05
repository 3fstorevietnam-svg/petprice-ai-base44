import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/PageHeader';
import FormDialog from '@/components/admin/FormDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Brain, Plus, Sparkles, RefreshCw, Search, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';

const ACTION_STYLES = {
  GIU_GIA:  { cls: 'bg-blue-100 text-blue-800 border-blue-200',   label: 'GIỮ GIÁ' },
  TANG_GIA: { cls: 'bg-emerald-100 text-emerald-800 border-emerald-200', label: 'TĂNG GIÁ' },
  GIAM_GIA: { cls: 'bg-red-100 text-red-800 border-red-200',      label: 'GIẢM GIÁ' },
  GOM_COMBO:{ cls: 'bg-purple-100 text-purple-800 border-purple-200', label: 'GOM COMBO' },
  KILL_SKU: { cls: 'bg-gray-200 text-gray-700 border-gray-300',    label: 'KILL SKU' },
};
const ADS_STYLES = {
  GIU_NGUYEN:            { cls: 'bg-muted text-muted-foreground',          label: 'Giữ Nguyên' },
  CHAY_ADS:              { cls: 'bg-orange-100 text-orange-800',           label: 'CHẠY ADS' },
  NGUNG_ADS:             { cls: 'bg-yellow-100 text-yellow-800',           label: 'NGỪNG ADS' },
  TEST_LAI_GIA_VA_CONTENT:{ cls: 'bg-violet-100 text-violet-800',          label: 'Test Lại' },
};
const STATUS_STYLES = {
  pending:  'bg-orange-100 text-orange-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  testing:  'bg-blue-100 text-blue-700',
};

const FILTER_BUTTONS = [
  { key: 'all',        label: 'Tất cả' },
  { key: 'pending',    label: '⏳ Chờ duyệt' },
  { key: 'losing',     label: '🔴 Đang lỗ' },
  { key: 'GOM_COMBO',  label: '🔵 Combo' },
  { key: 'KILL_SKU',   label: '💀 Kill SKU' },
  { key: 'NGUNG_ADS',  label: '🛑 Ngừng Ads' },
  { key: 'CHAY_ADS',   label: '📢 Chạy Ads' },
];

const FIELDS = [
  { key: 'sku', label: 'SKU', required: true },
  { key: 'rec_date', label: 'Date', type: 'date', required: true },
  { key: 'current_price', label: 'Current Price (₫)', type: 'number' },
  { key: 'current_profit', label: 'Current Profit (₫)', type: 'number' },
  { key: 'current_margin', label: 'Margin (%)', type: 'number', step: '0.01' },
  { key: 'suggested_action', label: 'Pricing Action', type: 'select', options: Object.entries(ACTION_STYLES).map(([v, c]) => ({ value: v, label: c.label })) },
  { key: 'suggested_price', label: 'Suggested Price (₫)', type: 'number' },
  { key: 'suggested_combo_qty', label: 'Combo Qty', type: 'number' },
  { key: 'ads_action', label: 'Ads Action', type: 'select', options: Object.entries(ADS_STYLES).map(([v, c]) => ({ value: v, label: c.label })) },
  { key: 'confidence', label: 'Confidence (0-100)', type: 'number' },
  { key: 'status', label: 'Status', type: 'select', options: ['pending','approved','rejected','testing'].map(v => ({ value: v, label: v })) },
  { key: 'reason', label: 'Reason', type: 'textarea', fullWidth: true },
  { key: 'admin_note', label: 'Admin Note', type: 'textarea', fullWidth: true },
];

const DEFAULTS = { sku: '', rec_date: format(new Date(), 'yyyy-MM-dd'), suggested_action: 'GIU_GIA', ads_action: 'GIU_NGUYEN', status: 'pending', confidence: 70 };

function ConfidenceBar({ value }) {
  const pct = Math.min(100, Math.max(0, value || 0));
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-red-400';
  return (
    <div className="flex items-center gap-1.5 w-20">
      <div className="flex-1 bg-muted rounded-full h-1.5">
        <div className={cn('h-1.5 rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

function ReasonExpand({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return <span className="text-muted-foreground/40 text-xs italic">—</span>;
  return (
    <div className="max-w-[220px]">
      <p className={cn('text-xs text-muted-foreground leading-relaxed', !open && 'line-clamp-2')}>{text}</p>
      {text.length > 80 && (
        <button onClick={() => setOpen(v => !v)} className="text-[10px] text-primary hover:underline mt-0.5 flex items-center gap-0.5">
          {open ? 'Thu gọn' : 'Xem thêm'} <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
        </button>
      )}
    </div>
  );
}

export default function AISuggestions() {
  const [suggestions, setSuggestions] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [skuSearch, setSkuSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(DEFAULTS);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      base44.entities.AISuggestion.list('-rec_date', 5000),
      base44.entities.Product.list('-updated_date', 5000),
    ]).then(([s, p]) => { setSuggestions(s); setProducts(p); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(DEFAULTS); setOpen(true); };
  const openEdit = (row) => { setEditing(row); setForm({ ...row }); setOpen(true); };
  const onChange = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    const payload = { ...form, current_price: parseFloat(form.current_price) || undefined, current_profit: parseFloat(form.current_profit) || undefined, current_margin: parseFloat(form.current_margin) || undefined, suggested_price: parseFloat(form.suggested_price) || undefined, confidence: parseFloat(form.confidence) || undefined };
    if (editing) await base44.entities.AISuggestion.update(editing.id, payload);
    else await base44.entities.AISuggestion.create(payload);
    toast.success('Saved');
    setOpen(false);
    load();
    setSaving(false);
  };
  const handleDelete = async () => { await base44.entities.AISuggestion.delete(editing.id); toast.success('Deleted'); setOpen(false); load(); };

  const quickStatus = async (row, status) => {
    await base44.entities.AISuggestion.update(row.id, { status });
    toast.success(`Marked ${status}`);
    load();
  };

  const generateSuggestions = async () => {
    setGenerating(true);
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
      toast.success(`AI xong! ${totalProcessed} SKUs xử lý — ${totalCreated} mới, ${totalUpdated} cập nhật`);
      load();
    } catch (e) {
      toast.error('AI analysis failed: ' + e.message);
    } finally {
      setGenerating(false);
    }
  };

  // Only count/show pending from the latest rec_date batch
  const latestRecDate = suggestions.reduce((best, s) => (!best || s.rec_date > best ? s.rec_date : best), null);
  const latestPendingSuggestions = suggestions.filter(s => s.status === 'pending' && s.rec_date === latestRecDate);

  const filtered = suggestions.filter(s => {
    const matchSku = !skuSearch || s.sku?.toLowerCase().includes(skuSearch.toLowerCase());
    if (!matchSku) return false;
    // "pending" tab only shows latest batch pending
    if (activeFilter === 'pending') return s.status === 'pending' && s.rec_date === latestRecDate;
    if (activeFilter === 'all') return true;
    if (activeFilter === 'losing') return (s.current_profit !== undefined && s.current_profit !== null && s.current_profit < 0) || (s.current_margin !== undefined && s.current_margin !== null && s.current_margin < 0);
    if (activeFilter === 'NGUNG_ADS') return s.ads_action === 'NGUNG_ADS';
    if (activeFilter === 'CHAY_ADS') return s.ads_action === 'CHAY_ADS';
    return s.suggested_action === activeFilter;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="AI Pricing Suggestions" subtitle={`${latestPendingSuggestions.length} pending approval${latestRecDate ? ` (${latestRecDate})` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={openCreate}><Plus className="w-4 h-4 mr-1.5" />Manual</Button>
            <Button size="sm" onClick={generateSuggestions} disabled={generating}>
              {generating ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
              {generating ? 'Đang phân tích...' : 'Chạy AI'}
            </Button>
          </div>
        }
      />

      {/* Filter Bar */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-card/30 flex-shrink-0 overflow-x-auto">
        {FILTER_BUTTONS.map(f => (
          <button key={f.key} onClick={() => setActiveFilter(f.key)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border',
              activeFilter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent hover:border-border hover:text-foreground'
            )}>
            {f.label}
          </button>
        ))}
        <div className="relative ml-auto flex-shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="SKU..." className="pl-8 h-7 text-xs w-32" value={skuSearch} onChange={e => setSkuSearch(e.target.value)} />
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-0">{filtered.length}</span>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs min-w-[1300px]">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-muted/80 backdrop-blur">
              {['SKU', 'Ngày', 'Giá hiện tại', 'Lợi nhuận', 'Margin', 'Mkt Avg', 'Comp. Price', 'Rank', 'Hành động', 'Giá đề xuất', 'Combo Qty', 'Ads', 'Confidence', 'Lý do', 'Trạng thái', ''].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? Array(5).fill(0).map((_, i) => (
              <tr key={i}>{Array(16).fill(0).map((_, j) => <td key={j} className="px-3 py-3"><div className="h-3 bg-muted rounded animate-pulse" /></td>)}</tr>
            )) : filtered.length === 0 ? (
              <tr><td colSpan={16} className="py-16 text-center text-muted-foreground">
                <Brain className="w-8 h-8 mx-auto mb-2 opacity-20" />Không có dữ liệu. Nhấn "Chạy AI" để tạo gợi ý.
              </td></tr>
            ) : filtered.map(s => {
              const isLosing = (s.current_profit !== null && s.current_profit !== undefined && s.current_profit < 0) || (s.current_margin !== null && s.current_margin !== undefined && s.current_margin < 0);
              const actionStyle = ACTION_STYLES[s.suggested_action] || {};
              const adsStyle = ADS_STYLES[s.ads_action] || {};
              const prod = products.find(p => p.sku === s.sku);
              return (
                <tr key={s.id} className={cn('hover:bg-muted/20 transition-colors', isLosing && 'bg-red-50 hover:bg-red-50/70', s.suggested_action === 'GOM_COMBO' && !isLosing && 'bg-purple-50/40', s.suggested_action === 'KILL_SKU' && !isLosing && 'bg-gray-50')}>
                  <td className="px-3 py-2.5"><span className="font-mono font-semibold">{s.sku}</span></td>
                  <td className="px-3 py-2.5 text-muted-foreground">{s.rec_date}</td>
                  <td className="px-3 py-2.5 font-mono">{s.current_price ? `₫${parseFloat(s.current_price).toLocaleString()}` : '—'}</td>
                  <td className="px-3 py-2.5">
                    {s.current_profit !== null && s.current_profit !== undefined ? (
                      <span className={cn('font-mono font-bold', s.current_profit < 0 ? 'text-red-600' : 'text-emerald-600')}>
                        ₫{parseFloat(s.current_profit).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {s.current_margin !== null && s.current_margin !== undefined ? (
                      <span className={cn('font-bold', s.current_margin < 0 ? 'text-red-600' : s.current_margin < 10 ? 'text-yellow-600' : 'text-emerald-600')}>
                        {parseFloat(s.current_margin).toFixed(1)}%
                      </span>
                    ) : '—'}
                  </td>
                  {/* Market Intelligence */}
                  <td className="px-3 py-2.5 font-mono text-muted-foreground text-xs">
                    {prod?.market_avg ? `₫${parseFloat(prod.market_avg).toLocaleString()}` : <span className="opacity-30">—</span>}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">
                    {prod?.competitor_price ? <span className="font-semibold">₫{parseFloat(prod.competitor_price).toLocaleString()}</span> : <span className="opacity-30">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs">
                    {prod?.current_rank ? (
                      <span className={cn('font-bold', prod.current_rank <= 10 ? 'text-emerald-600' : prod.current_rank <= 20 ? 'text-yellow-600' : 'text-muted-foreground')}>#{prod.current_rank}</span>
                    ) : <span className="opacity-30">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {s.suggested_action ? <span className={cn('text-[10px] font-bold px-2 py-1 rounded-md border', actionStyle.cls)}>{actionStyle.label || s.suggested_action}</span> : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {s.suggested_price ? (
                      <div>
                        <span className="font-mono font-semibold">₫{parseFloat(s.suggested_price).toLocaleString()}</span>
                        {s.current_price && (
                          <span className={cn('text-[10px] ml-1', parseFloat(s.suggested_price) > parseFloat(s.current_price) ? 'text-emerald-600' : 'text-red-500')}>
                            {((parseFloat(s.suggested_price) - parseFloat(s.current_price)) / parseFloat(s.current_price) * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center">{s.suggested_combo_qty || '—'}</td>
                  <td className="px-3 py-2.5">
                    {s.ads_action ? <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', adsStyle.cls)}>{adsStyle.label || s.ads_action}</span> : '—'}
                  </td>
                  <td className="px-3 py-2.5"><ConfidenceBar value={s.confidence} /></td>
                  <td className="px-3 py-2.5"><ReasonExpand text={s.reason} /></td>
                  <td className="px-3 py-2.5">
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', STATUS_STYLES[s.status])}>{s.status}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => openEdit(s)}>Edit</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <FormDialog open={open} onOpenChange={setOpen} title="AI Suggestion" fields={FIELDS} form={form} onChange={onChange} onSave={handleSave} onDelete={editing ? handleDelete : undefined} saving={saving} editing={editing} />
    </div>
  );
}