import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/PageHeader';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Package, TrendingDown, Layers, TrendingUp, Skull,
  Megaphone, MegaphoneOff, AlertTriangle, ArrowRight,
  DollarSign, Zap, RefreshCw, Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

function KpiCard({ label, value, icon: Icon, color = 'default', sub }) {
  const colors = {
    default: 'bg-card border-border',
    red: 'bg-red-50 border-red-200',
    green: 'bg-emerald-50 border-emerald-200',
    orange: 'bg-orange-50 border-orange-200',
    purple: 'bg-purple-50 border-purple-200',
    gray: 'bg-gray-50 border-gray-200',
    blue: 'bg-blue-50 border-blue-200',
  };
  const iconColors = {
    default: 'text-muted-foreground bg-muted',
    red: 'text-red-600 bg-red-100',
    green: 'text-emerald-600 bg-emerald-100',
    orange: 'text-orange-600 bg-orange-100',
    purple: 'text-purple-600 bg-purple-100',
    gray: 'text-gray-500 bg-gray-100',
    blue: 'text-blue-600 bg-blue-100',
  };
  return (
    <div className={cn('border rounded-xl p-4 flex items-center gap-3', colors[color])}>
      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', iconColors[color])}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
        <p className="text-2xl font-bold text-foreground leading-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function SectionTable({ title, rows, columns, emptyText, colorClass, linkTo, linkLabel }) {
  return (
    <div className={cn('bg-card border rounded-xl overflow-hidden', colorClass)}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <h3 className="font-semibold text-sm">{title}</h3>
        {linkTo && (
          <Button variant="ghost" size="sm" asChild className="text-xs h-7">
            <Link to={linkTo}>{linkLabel || 'View all'} <ArrowRight className="w-3 h-3 ml-1" /></Link>
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-sm text-muted-foreground text-center">{emptyText}</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              {columns.map(c => <th key={c.key} className="text-left px-4 py-2 font-semibold text-muted-foreground uppercase tracking-wide">{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.slice(0, 8).map((row, i) => (
              <tr key={i} className="hover:bg-muted/10">
                {columns.map(c => (
                  <td key={c.key} className="px-4 py-2.5">
                    {c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [products, setProducts] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const loadData = () => {
    Promise.all([
      base44.entities.Product.list('-created_date', 200),
      base44.entities.AISuggestion.list('-rec_date', 300),
    ]).then(([p, s]) => { setProducts(p); setSuggestions(s); setLoading(false); });
  };

  useEffect(() => { loadData(); }, []);

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
      toast.success(`✅ AI xong! ${totalProcessed} SKUs xử lý — ${totalCreated} mới, ${totalUpdated} cập nhật.`);
      loadData();
    } catch (e) {
      toast.error('AI analysis thất bại: ' + e.message);
    } finally {
      setRunning(false);
    }
  };

  function calcProfit(p) {
    if (!p?.current_price || !p?.cost) return null;
    const price = parseFloat(p.current_price);
    const cost = parseFloat(p.cost);
    const feeRate = parseFloat(p.shopee_fee_rate) || 0.22;
    const FIXED_COST = 15833;
    return price * (1 - feeRate) - cost - FIXED_COST;
  }

  const activeProducts = products.filter(p => p.status === 'active');
  const losingProducts = activeProducts.filter(p => { const profit = calcProfit(p); return profit !== null && profit < 0; });

  const pending = suggestions.filter(s => s.status === 'pending');
  const countAction = (action) => pending.filter(s => s.suggested_action === action).length;
  const countAds = (action) => pending.filter(s => s.ads_action === action).length;

  const urgentIssues = losingProducts.map(p => {
    const profit = calcProfit(p);
    const margin = p.current_price ? (profit / parseFloat(p.current_price) * 100) : null;
    return { ...p, profit, margin };
  });

  const comboOpps = pending.filter(s => s.suggested_action === 'GOM_COMBO');
  const killCandidates = pending.filter(s => s.suggested_action === 'KILL_SKU');
  const adsStop = pending.filter(s => s.ads_action === 'NGUNG_ADS');

  const bestCore = activeProducts
    .filter(p => p.sku_role === 'core' && calcProfit(p) > 0)
    .map(p => ({ ...p, profit: calcProfit(p), margin: parseFloat(p.current_price) ? calcProfit(p) / parseFloat(p.current_price) * 100 : 0 }))
    .sort((a, b) => b.profit - a.profit);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Overview Dashboard" subtitle="Operational summary — all SKUs"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={runAI} disabled={running} className="gap-1.5 font-semibold text-sm">
              {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {running ? 'Đang chạy AI...' : 'Chạy AI'}
            </Button>
            <Button asChild className="gap-1.5 bg-primary hover:bg-primary/90 font-semibold text-sm">
              <Link to="/approval-queue"><DollarSign className="w-4 h-4" />Approval Queue →</Link>
            </Button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Active SKUs" value={loading ? '…' : activeProducts.length} icon={Package} color="default" />
          <KpiCard label="Losing SKUs" value={loading ? '…' : losingProducts.length} icon={TrendingDown} color="red" sub="Profit < 0" />
          <KpiCard label="Combo Suggestions" value={loading ? '…' : countAction('GOM_COMBO')} icon={Layers} color="purple" sub="Pending" />
          <KpiCard label="Increase Price" value={loading ? '…' : countAction('TANG_GIA')} icon={TrendingUp} color="green" sub="Pending" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Decrease Price" value={loading ? '…' : countAction('GIAM_GIA')} icon={TrendingDown} color="orange" sub="Pending" />
          <KpiCard label="Kill SKU" value={loading ? '…' : countAction('KILL_SKU')} icon={Skull} color="gray" sub="Pending" />
          <KpiCard label="Run Ads" value={loading ? '…' : countAds('CHAY_ADS')} icon={Megaphone} color="blue" sub="Pending" />
          <KpiCard label="Stop Ads" value={loading ? '…' : countAds('NGUNG_ADS')} icon={MegaphoneOff} color="orange" sub="Pending" />
        </div>

        {/* Tables Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SectionTable
            title="🚨 Urgent — Losing Money SKUs"
            rows={urgentIssues}
            colorClass="border-red-200"
            linkTo="/products"
            linkLabel="View products"
            emptyText="No losing SKUs — great!"
            columns={[
              { key: 'sku', label: 'SKU', render: v => <span className="font-mono font-semibold text-red-700">{v}</span> },
              { key: 'name', label: 'Name', render: v => <span className="truncate max-w-[120px] block">{v}</span> },
              { key: 'current_price', label: 'Price', render: v => <span className="font-mono">₫{parseFloat(v || 0).toLocaleString()}</span> },
              { key: 'profit', label: 'Profit', render: v => <span className="font-mono font-bold text-red-600">₫{(v || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}</span> },
              { key: 'margin', label: 'Margin', render: v => <span className="text-red-600 font-bold">{(v || 0).toFixed(1)}%</span> },
            ]}
          />

          <SectionTable
            title="🎯 Combo Opportunities"
            rows={comboOpps}
            colorClass="border-purple-200"
            linkTo="/approval-queue"
            emptyText="No combo suggestions pending."
            columns={[
              { key: 'sku', label: 'SKU', render: v => <span className="font-mono font-semibold text-purple-700">{v}</span> },
              { key: 'current_price', label: 'Price', render: v => v ? <span className="font-mono">₫{parseFloat(v).toLocaleString()}</span> : '—' },
              { key: 'suggested_combo_qty', label: 'Combo Qty', render: v => <span className="font-bold text-purple-700">{v || '—'}</span> },
              { key: 'confidence', label: 'Conf.', render: v => v ? <span>{v}%</span> : '—' },
            ]}
          />
        </div>

        {/* Tables Row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <SectionTable
            title="💀 Kill Candidates"
            rows={killCandidates}
            colorClass="border-gray-300"
            linkTo="/kill-list"
            emptyText="No kill candidates."
            columns={[
              { key: 'sku', label: 'SKU', render: v => <span className="font-mono text-gray-600 font-semibold">{v}</span> },
              { key: 'current_price', label: 'Price', render: v => v ? <span className="font-mono">₫{parseFloat(v).toLocaleString()}</span> : '—' },
              { key: 'confidence', label: 'Conf.', render: v => v ? `${v}%` : '—' },
            ]}
          />

          <SectionTable
            title="🛑 Stop Ads Candidates"
            rows={adsStop}
            colorClass="border-yellow-200"
            linkTo="/approval-queue"
            emptyText="No stop-ads candidates."
            columns={[
              { key: 'sku', label: 'SKU', render: v => <span className="font-mono font-semibold text-yellow-700">{v}</span> },
              { key: 'current_price', label: 'Price', render: v => v ? <span className="font-mono">₫{parseFloat(v).toLocaleString()}</span> : '—' },
              { key: 'confidence', label: 'Conf.', render: v => v ? `${v}%` : '—' },
            ]}
          />

          <SectionTable
            title="⭐ Best Profitable Core SKUs"
            rows={bestCore}
            colorClass="border-emerald-200"
            linkTo="/products"
            emptyText="No profitable core SKUs yet."
            columns={[
              { key: 'sku', label: 'SKU', render: v => <span className="font-mono font-semibold text-emerald-700">{v}</span> },
              { key: 'current_price', label: 'Price', render: v => <span className="font-mono">₫{parseFloat(v || 0).toLocaleString()}</span> },
              { key: 'profit', label: 'Profit', render: v => <span className="font-mono font-bold text-emerald-600">₫{(v || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}</span> },
              { key: 'margin', label: 'Margin', render: v => <span className="text-emerald-700 font-bold">{(v || 0).toFixed(1)}%</span> },
            ]}
          />
        </div>
      </div>
    </div>
  );
}