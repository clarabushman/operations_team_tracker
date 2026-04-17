import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  AlertCircle, CheckCircle2, XCircle, Clock, BarChart3, 
  BatteryWarning, Zap, ChevronDown, Filter, Car, 
  Settings, Gauge, Info, Search, AlertTriangle, Battery, 
  ZapOff, Calendar, User, Building2, X, ArrowUpDown, Smile, MapPin,
  Download, Users
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';

// --- Utilities & Configuration ---
const parseCSV = (str) => {
  const arr = [];
  let quote = false;
  let row = 0, col = 0;
  for (let i = 0; i < str.length; i++) {
    let cc = str[i], nc = str[i + 1];
    arr[row] = arr[row] || [];
    arr[row][col] = arr[row][col] || '';
    if (cc === '"' && quote && nc === '"') { arr[row][col] += cc; ++i; continue; }
    if (cc === '"') { quote = !quote; continue; }
    if (cc === ',' && !quote) { ++col; continue; }
    if (cc === '\r' && nc === '\n' && !quote) { ++row; col = 0; ++i; continue; }
    if (cc === '\n' && !quote) { ++row; col = 0; continue; }
    arr[row][col] += cc;
  }
  return arr;
};

// Colors for charts
const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];

const isTrue = (val) => String(val).toUpperCase() === 'TRUE';
const getAddress = (r) => `${r.postal_number || ''} ${r.street_name || ''}`.trim();
const isZeroBills = (tariff) => String(tariff || '').toLowerCase().includes('zero');

const isSmartTeam = (team) => {
  const t = String(team).toUpperCase();
  return t.includes('SMART') || t.includes('SMT');
};

const isDateStale = (dateStr) => {
    if (!dateStr || String(dateStr).trim().toLowerCase() === 'null' || String(dateStr).trim() === '') return true;
    let safeDateStr = String(dateStr).trim();
    if (safeDateStr.includes('/')) {
        const parts = safeDateStr.split(/[ /]/);
        if (parts.length === 3 && parts[2].length === 4) {
            safeDateStr = `${parts[2]}-${parts[1]}-${parts[0]}`; 
        }
    }
    const readDate = new Date(safeDateStr);
    if (isNaN(readDate.getTime())) return true; 

    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    readDate.setHours(0, 0, 0, 0);

    const daysOld = Math.floor((currentDate.getTime() - readDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysOld > 3; 
}

const hasValidMpan = (val) => {
    return val && String(val).trim() !== '' && String(val).trim().toLowerCase() !== 'null';
};

export default function App() {
  const [data, setData] = useState([]);
  const [activeTab, setActiveTab] = useState('Overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Drilldown Modal State
  const [drillDownTitle, setDrillDownTitle] = useState('');
  const [drillDownData, setDrillDownData] = useState(null);
  const [modalSearch, setModalSearch] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

  // Tab-Specific States
  const [mpanTypeFilter, setMpanTypeFilter] = useState('All'); 

  // Global Portfolio Filters
  const [selectedSites, setSelectedSites] = useState(new Set());
  const [accountSearch, setAccountSearch] = useState('');
  const [tariffStatusFilter, setTariffStatusFilter] = useState('Both'); // 'Both', 'On Tariff', 'Not on Tariff'
  
  const [siteOpen, setSiteOpen] = useState(false);
  const siteRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (siteRef.current && !siteRef.current.contains(event.target)) setSiteOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await fetch('/data.csv');
        if (!response.ok) throw new Error("Missing data.csv in public folder.");
        const text = await response.text();
        const rows = parseCSV(text);
        const rawHeaders = rows[0].map(h => h?.trim());
        const parsed = rows.slice(1).filter(r => r.length > 1).map(row => {
          let obj = {};
          rawHeaders.forEach((h, i) => { obj[h] = row[i]?.trim(); });
          return obj;
        });
        setData(parsed);
      } catch (err) { setError(err.message); }
      finally { setLoading(false); }
    };
    loadData();
  }, []);

  // --- Global Filtering ---
  const filteredData = useMemo(() => {
    return data.filter(row => {
      const matchSite = selectedSites.size === 0 || selectedSites.has(row.site_name);
      const matchAcc = !accountSearch || String(row.latest_account_number_for_address || '').toLowerCase().includes(accountSearch.toLowerCase());
      
      let matchTariffStatus = true;
      if (tariffStatusFilter === 'On Tariff') {
        matchTariffStatus = isZeroBills(row.import_tariff);
      } else if (tariffStatusFilter === 'Not on Tariff') {
        matchTariffStatus = !isZeroBills(row.import_tariff);
      }

      return matchSite && matchAcc && matchTariffStatus;
    });
  }, [data, selectedSites, accountSearch, tariffStatusFilter]);

  const filterOptions = useMemo(() => {
    const sites = [...new Set(data.map(r => r.site_name))].filter(Boolean).sort();
    return { sites };
  }, [data]);

  // --- Metrics Calculations ---
  const metrics = useMemo(() => {
    const tariffCounts = {};
    const typeCounts = {};
    const tariffMismatches = [];
    const opsTeamBreakdown = {};
    const nonSmartAccounts = [];
    const evConfirmed = [];
    const evSuspected = [];
    const noEv = [];
    let battSetup = [], battOnline = [], battOffline = [], battNotSetup = [];
    const batterySiteSummary = {};
    const missingMpans = [];
    const missingSmartReads = [];

    filteredData.forEach(r => {
      // 1. Overview counts (Attached accounts for modal click)
      const t = r.import_tariff || 'Unknown Tariff';
      if (!tariffCounts[t]) tariffCounts[t] = { name: t, value: 0, accounts: [] };
      tariffCounts[t].value++;
      tariffCounts[t].accounts.push(r);

      const at = r.account_type || 'Unknown Type';
      if (!typeCounts[at]) typeCounts[at] = { name: at, value: 0, accounts: [] };
      typeCounts[at].value++;
      typeCounts[at].accounts.push(r);

      // 2. Tariff Date Mismatches
      const checkMismatch = (d1, d2) => d1 && d2 && String(d1).trim().toLowerCase() !== 'null' && String(d2).trim().toLowerCase() !== 'null' && d1 !== d2;
      const hasMismatch = checkMismatch(r.kraken_import_tariff_valid_from, r.agreement_valid_from) ||
                          checkMismatch(r.kraken_import_tariff_valid_to, r.agreement_valid_to) ||
                          checkMismatch(r.kraken_export_tariff_valid_from, r.agreement_valid_from) ||
                          checkMismatch(r.kraken_export_tariff_valid_to, r.agreement_valid_to);

      if (hasMismatch) tariffMismatches.push(r);

      // 3. Ops Team Tracking
      const team = r.operations_team || 'Unassigned';
      if (!opsTeamBreakdown[team]) opsTeamBreakdown[team] = { name: team, total: 0, accounts: [] };
      opsTeamBreakdown[team].total++;
      opsTeamBreakdown[team].accounts.push(r);

      if (!isSmartTeam(team)) nonSmartAccounts.push(r);

      // 4. EV
      if (isTrue(r.ev_billed)) evConfirmed.push(r);
      else if (isTrue(r.suspected_ev)) evSuspected.push(r);
      else noEv.push(r);

      // 5. Battery Issues
      const siteName = r.site_name || 'Unknown Site';
      if (!batterySiteSummary[siteName]) {
          batterySiteSummary[siteName] = { name: siteName, total: 0, online: 0, offline: 0, notSetup: 0, onlineData: [], offlineData: [], notSetupData: [] };
      }
      batterySiteSummary[siteName].total++;

      if (isTrue(r.battery_setup)) {
          battSetup.push(r);
          if (isTrue(r.battery_signal)) {
              battOnline.push(r);
              batterySiteSummary[siteName].online++;
              batterySiteSummary[siteName].onlineData.push(r);
          } else {
              battOffline.push(r);
              batterySiteSummary[siteName].offline++;
              batterySiteSummary[siteName].offlineData.push(r);
          }
      } else {
          battNotSetup.push(r);
          batterySiteSummary[siteName].notSetup++;
          batterySiteSummary[siteName].notSetupData.push(r);
      }

      // 6. Missing MPANs
      if (!r.export_mpan || String(r.export_mpan).trim() === '' || String(r.export_mpan).toLowerCase() === 'null') {
          missingMpans.push(r);
      }

      // 7. Missing Smart Reads
      const impHasMpan = hasValidMpan(r.import_mpan);
      const expHasMpan = hasValidMpan(r.export_mpan);
      const impStale = impHasMpan && isDateStale(r.import_last_smart_read_date);
      const expStale = expHasMpan && isDateStale(r.export_last_smart_read_date);

      if (impStale || expStale) {
          missingSmartReads.push(r);
      }
    });

    return {
      tariffData: Object.values(tariffCounts).sort((a,b) => b.value - a.value),
      typeData: Object.values(typeCounts).sort((a,b) => b.value - a.value),
      tariffMismatches,
      opsTeamBreakdown: Object.values(opsTeamBreakdown).sort((a,b) => b.total - a.total),
      nonSmartAccounts,
      evConfirmed, evSuspected, noEv,
      totalBattery: filteredData.length,
      battSetup, battOnline, battOffline, battNotSetup,
      batterySiteSummary: Object.values(batterySiteSummary).sort((a,b) => b.total - a.total),
      missingMpans, missingSmartReads
    };
  }, [filteredData]);

  // --- Modal Logic ---
  const handleDrillDown = (title, list) => {
    setDrillDownTitle(title);
    setDrillDownData(list);
    setModalSearch('');
    setSortConfig({ key: null, direction: 'asc' });
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const processedModalData = useMemo(() => {
    if (!drillDownData) return [];
    let processed = [...drillDownData];
    
    if (modalSearch) {
      const lowerSearch = modalSearch.toLowerCase();
      processed = processed.filter(row => 
        Object.values(row).some(val => String(val).toLowerCase().includes(lowerSearch)) ||
        getAddress(row).toLowerCase().includes(lowerSearch)
      );
    }

    if (sortConfig.key) {
      processed.sort((a, b) => {
        let valA = a[sortConfig.key] || '';
        let valB = b[sortConfig.key] || '';
        if (!isNaN(parseFloat(valA)) && !isNaN(parseFloat(valB))) {
          valA = parseFloat(valA); valB = parseFloat(valB);
        }
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return processed;
  }, [drillDownData, modalSearch, sortConfig]);

  const DrillDownModal = () => {
    if (!drillDownData) return null;

    const SortIcon = ({ colKey }) => (
      <ArrowUpDown size={12} className={`inline ml-1 ${sortConfig.key === colKey ? 'text-indigo-600' : 'text-slate-300'}`} />
    );

    return (
      <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-[95vw] max-h-[90vh] flex flex-col">
          <div className="p-4 border-b flex justify-between items-center bg-slate-50 rounded-t-xl">
            <div>
              <h2 className="text-xl font-bold text-slate-800">{drillDownTitle} <span className="text-slate-500 text-sm font-normal">({processedModalData.length} records)</span></h2>
            </div>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                <input 
                  type="text" placeholder="Search rows..." value={modalSearch} onChange={e => setModalSearch(e.target.value)}
                  className="pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 w-64"
                />
              </div>
              <button onClick={() => setDrillDownData(null)} className="p-2 hover:bg-slate-200 rounded-full transition"><X size={20}/></button>
            </div>
          </div>
          <div className="overflow-auto p-4 flex-1">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="bg-slate-100 text-slate-600 sticky top-0 z-10 shadow-sm cursor-pointer">
                <tr>
                  <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('latest_account_number_for_address')}>Account <SortIcon colKey="latest_account_number_for_address"/></th>
                  <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('postal_number')}>Address <SortIcon colKey="postal_number"/></th>
                  <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('postcode')}>Postcode <SortIcon colKey="postcode"/></th>
                  <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('site_name')}>Site <SortIcon colKey="site_name"/></th>
                  <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('account_type')}>Type <SortIcon colKey="account_type"/></th>
                  <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('import_tariff')}>Import Tariff <SortIcon colKey="import_tariff"/></th>
                  <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('export_tariff')}>Export Tariff <SortIcon colKey="export_tariff"/></th>
                  <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('operations_team')}>Ops Team <SortIcon colKey="operations_team"/></th>
                  <th className="p-3 hover:bg-slate-200 text-center" onClick={() => handleSort('is_psr')}>PSR <SortIcon colKey="is_psr"/></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 flex-1">
                {processedModalData.map((row, i) => {
                  const isDev = String(row.account_type).toLowerCase() === 'developer';
                  const hasZeroBillsImp = isZeroBills(row.import_tariff);
                  const hasZeroBillsExp = isZeroBills(row.export_tariff);

                  return (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="p-3 font-medium text-slate-900">{row.latest_account_number_for_address || row.import_mpan}</td>
                      <td className="p-3">{getAddress(row)}</td>
                      <td className="p-3">{row.postcode}</td>
                      <td className="p-3 font-medium">{row.site_name}</td>
                      <td className="p-3 capitalize">{row.account_type}</td>
                      <td className={`p-3 max-w-[200px] truncate ${isDev && hasZeroBillsImp ? 'bg-red-50 text-red-700 font-bold' : ''}`} title={row.import_tariff}>
                        {row.import_tariff}
                        {isDev && hasZeroBillsImp && (
                           <span className="ml-2 inline-block px-1.5 py-0.5 bg-red-100 text-red-700 text-[10px] font-black uppercase rounded border border-red-300" title="Developers should not be on a Zero Bills tariff">Flagged</span>
                        )}
                      </td>
                      <td className={`p-3 max-w-[200px] truncate ${isDev && hasZeroBillsExp ? 'bg-red-50 text-red-700 font-bold' : ''}`} title={row.export_tariff}>
                        {row.export_tariff}
                        {isDev && hasZeroBillsExp && (
                           <span className="ml-2 inline-block px-1.5 py-0.5 bg-red-100 text-red-700 text-[10px] font-black uppercase rounded border border-red-300" title="Developers should not be on a Zero Bills tariff">Flagged</span>
                        )}
                      </td>
                      <td className="p-3 font-semibold text-indigo-700">{row.operations_team}</td>
                      <td className="p-3 text-center">{isTrue(row.is_psr) ? '✅' : '⬜'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {processedModalData.length === 0 && <p className="text-center text-slate-500 py-8">No records match your search.</p>}
          </div>
        </div>
      </div>
    );
  };

  if (loading) return <div className="p-10 text-center flex justify-center items-center h-screen text-slate-500"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mr-3"></div> Loading Dashboard...</div>;
  if (error) return <div className="p-10 text-red-600 font-bold max-w-3xl mx-auto mt-10 bg-red-50 rounded-lg border border-red-200">Error: {error}</div>;

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-20">
      
      {/* Header & Filter Bar */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-[95%] mx-auto px-4 py-4 flex flex-col md:flex-row justify-between md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Gauge className="text-indigo-600"/> Zero Bills Tracking App
            </h1>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-slate-500 flex items-center gap-1"><Filter size={16}/> Global Filters</span>
            
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
              <input 
                  type="text" placeholder="Search by Account..." value={accountSearch} onChange={e => setAccountSearch(e.target.value)}
                  className="w-48 pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition"
              />
            </div>

            <select 
              value={tariffStatusFilter} 
              onChange={e => setTariffStatusFilter(e.target.value)}
              className="px-4 py-2 text-sm border border-slate-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="Both">Tariff Status: Both</option>
              <option value="On Tariff">On Tariff (Zero Bills)</option>
              <option value="Not on Tariff">Not on Tariff (Standard)</option>
            </select>

            <div className="relative" ref={siteRef}>
              <button onClick={() => setSiteOpen(!siteOpen)} className="px-4 py-2 text-sm border border-slate-300 rounded-lg bg-white flex items-center gap-2 hover:bg-slate-50">
                Sites ({selectedSites.size || 'All'}) <ChevronDown size={14}/>
              </button>
              {siteOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-white border shadow-xl rounded-lg p-2 max-h-64 overflow-y-auto z-50">
                  {filterOptions.sites.map(s => (
                    <label key={s} className="flex items-center gap-2 p-2 hover:bg-slate-50 cursor-pointer rounded text-sm">
                      <input type="checkbox" className="rounded text-indigo-600 focus:ring-indigo-500" checked={selectedSites.has(s)} onChange={() => {
                        const next = new Set(selectedSites);
                        next.has(s) ? next.delete(s) : next.add(s);
                        setSelectedSites(next);
                      }}/> {s}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="max-w-[95%] mx-auto px-4 mt-6">
        <div className="flex border-b border-slate-200 overflow-x-auto hide-scrollbar">
          {['Overview', 'Tariff Dates', 'Operations Team', 'EV', 'Battery Issues', 'Missing MPANs', 'Missing Smart Reads'].map(tab => (
            <button 
              key={tab} 
              onClick={() => setActiveTab(tab)}
              className={`pb-3 px-4 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 ${activeTab === tab ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-[95%] mx-auto px-4 mt-6">
        
        {/* Tab 1: Overview */}
        {activeTab === 'Overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Tariff Breakdown Chart */}
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col h-[400px]">
                <h3 className="text-slate-800 font-bold mb-2 flex items-center gap-2"><Zap className="text-amber-500"/> Account Breakdown by Tariff</h3>
                <p className="text-xs text-slate-500 text-center">Click a chart slice to view the full account list</p>
                <div className="flex-1 w-full relative cursor-pointer">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie 
                                data={metrics.tariffData} 
                                cx="50%" cy="50%" innerRadius={70} outerRadius={110} paddingAngle={2} dataKey="value"
                                onClick={(entry) => handleDrillDown(`Tariff: ${entry.name}`, entry.accounts)}
                                label={({ payload, cx, x, y, textAnchor }) => (
                                    <text x={x} y={y} cx={cx} textAnchor={textAnchor} dominantBaseline="central" className="text-xs font-semibold fill-slate-700">
                                        {payload.value}
                                    </text>
                                )}
                            >
                                {metrics.tariffData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} className="hover:opacity-80 transition" />
                                ))}
                            </Pie>
                            <RechartsTooltip formatter={(value, name) => [`${value} Accounts`, name]} />
                            <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{fontSize: '12px', right: 0}} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
              </div>

              {/* Developer vs Customer Chart */}
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col h-[400px]">
                <h3 className="text-slate-800 font-bold mb-2 flex items-center gap-2"><User className="text-indigo-500"/> Developer vs. Customer Accounts</h3>
                <p className="text-xs text-slate-500 text-center">Click a chart slice to view the full account list</p>
                <div className="flex-1 w-full relative cursor-pointer">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie 
                                data={metrics.typeData} 
                                cx="50%" cy="50%" innerRadius={70} outerRadius={110} paddingAngle={2} dataKey="value"
                                onClick={(entry) => handleDrillDown(`Type: ${entry.name}`, entry.accounts)}
                                label={({ payload, cx, x, y, textAnchor }) => (
                                    <text x={x} y={y} cx={cx} textAnchor={textAnchor} dominantBaseline="central" className="text-xs font-semibold fill-slate-700">
                                        {payload.value}
                                    </text>
                                )}
                            >
                                {metrics.typeData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={['#8b5cf6', '#14b8a6'][index % 2]} className="hover:opacity-80 transition" />
                                ))}
                            </Pie>
                            <RechartsTooltip formatter={(value, name) => [`${value} Accounts`, name]} />
                            <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{fontSize: '12px'}} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
              </div>
              
            </div>
          </div>
        )}

        {/* Tab 2: Tariff Dates */}
        {activeTab === 'Tariff Dates' && (
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="p-6 border-b bg-amber-50/50 flex flex-col gap-2">
              <h2 className="text-lg font-bold text-amber-700 flex items-center gap-2"><Calendar size={20}/> Tariff Date Mismatches ({metrics.tariffMismatches.length})</h2>
              <p className="text-sm text-amber-700/80">
                Accounts flagged below have Kraken import or export dates that do not match the assigned `agreement_valid_from` or `agreement_valid_to` dates. Review to manually correct within Kraken.
              </p>
            </div>
            <div className="overflow-x-auto flex-1 max-h-[70vh]">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-slate-100 text-slate-600 sticky top-0 shadow-sm z-10">
                  <tr>
                    <th className="p-3">Account</th>
                    <th className="p-3">Site</th>
                    <th className="p-3 border-l-2 border-slate-300">Agreement From</th>
                    <th className="p-3">Kraken Imp From</th>
                    <th className="p-3 border-r-2 border-slate-300">Kraken Exp From</th>
                    <th className="p-3">Agreement To</th>
                    <th className="p-3">Kraken Imp To</th>
                    <th className="p-3 border-r-2 border-slate-300">Kraken Exp To</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {metrics.tariffMismatches.map((r, i) => {
                    const check = (krak, agree) => krak && agree && String(krak).trim().toLowerCase() !== 'null' && String(agree).trim().toLowerCase() !== 'null' && krak !== agree;
                    
                    const ifM = check(r.kraken_import_tariff_valid_from, r.agreement_valid_from);
                    const efM = check(r.kraken_export_tariff_valid_from, r.agreement_valid_from);
                    const itM = check(r.kraken_import_tariff_valid_to, r.agreement_valid_to);
                    const etM = check(r.kraken_export_tariff_valid_to, r.agreement_valid_to);

                    return (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="p-3 font-medium text-slate-900">{r.latest_account_number_for_address}</td>
                        <td className="p-3 text-slate-700 font-medium max-w-[150px] truncate" title={r.site_name}>{r.site_name}</td>
                        
                        <td className="p-3 border-l-2 border-slate-100 font-bold text-slate-700">{r.agreement_valid_from || 'N/A'}</td>
                        <td className={`p-3 ${ifM ? 'bg-red-50 text-red-600 font-bold' : ''}`}>{r.kraken_import_tariff_valid_from || 'N/A'}</td>
                        <td className={`p-3 border-r-2 border-slate-100 ${efM ? 'bg-red-50 text-red-600 font-bold' : ''}`}>{r.kraken_export_tariff_valid_from || 'N/A'}</td>
                        
                        <td className="p-3 font-bold text-slate-700">{r.agreement_valid_to || 'N/A'}</td>
                        <td className={`p-3 ${itM ? 'bg-red-50 text-red-600 font-bold' : ''}`}>{r.kraken_import_tariff_valid_to || 'N/A'}</td>
                        <td className={`p-3 border-r-2 border-slate-100 ${etM ? 'bg-red-50 text-red-600 font-bold' : ''}`}>{r.kraken_export_tariff_valid_to || 'N/A'}</td>
                      </tr>
                    );
                  })}
                  {metrics.tariffMismatches.length === 0 && <tr><td colSpan="8" className="p-10 text-center text-emerald-600 font-medium">All tariff dates align with agreements!</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Operations Team */}
        {activeTab === 'Operations Team' && (
          <div className="space-y-6">
            
            {/* Non-SMART Alert Card */}
            {metrics.nonSmartAccounts.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                 <div>
                    <h3 className="text-red-800 font-bold text-lg flex items-center gap-2"><AlertTriangle /> Non-SMART Team Assignments Detected</h3>
                    <p className="text-red-600/90 mt-1 text-sm font-medium">
                      There are {metrics.nonSmartAccounts.length} accounts assigned to teams that do not contain "SMART" or "SMT" in their name.
                    </p>
                 </div>
                 <button onClick={() => handleDrillDown('Non-SMART Accounts', metrics.nonSmartAccounts)} className="px-5 py-2 bg-white text-red-600 border border-red-200 rounded-lg hover:bg-red-100 font-bold transition whitespace-nowrap shadow-sm">
                   View Flagged Accounts
                 </button>
              </div>
            )}

            {/* Grid of Team Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
               {metrics.opsTeamBreakdown.map((t, i) => (
                   <div 
                      key={i} 
                      onClick={() => handleDrillDown(`Team: ${t.name}`, t.accounts)} 
                      className={`bg-white border p-5 rounded-xl shadow-sm cursor-pointer hover:shadow-md transition ${!isSmartTeam(t.name) ? 'border-red-300 bg-red-50/30 hover:border-red-500' : 'hover:border-indigo-400'}`}
                    >
                       <div className="flex items-center gap-2 mb-2">
                           <Users size={16} className={!isSmartTeam(t.name) ? 'text-red-500' : 'text-indigo-500'}/>
                           <div className="text-sm font-bold text-slate-700 truncate" title={t.name}>{t.name}</div>
                       </div>
                       <div className="text-3xl font-black text-slate-900">{t.total} <span className="text-sm font-normal text-slate-500 ml-1">Accts</span></div>
                   </div>
               ))}
               {metrics.opsTeamBreakdown.length === 0 && <div className="col-span-full p-10 text-center text-slate-500">No team data found for current filters.</div>}
            </div>

          </div>
        )}

        {/* Tab 4: EV */}
        {activeTab === 'EV' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <div className="bg-white border rounded-xl shadow-sm p-6">
                <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2"><Car className="text-indigo-500"/> EV User Breakdown</h2>
                <div className="h-72 w-full cursor-pointer">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie 
                                data={[
                                    { name: 'Confirmed EVs', value: metrics.evConfirmed.length, list: metrics.evConfirmed },
                                    { name: 'Suspected EVs', value: metrics.evSuspected.length, list: metrics.evSuspected },
                                    { name: 'No EV Suspected', value: metrics.noEv.length, list: metrics.noEv }
                                ]}
                                cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={5} dataKey="value"
                                label={({ payload, cx, x, y, textAnchor }) => (
                                    <text x={x} y={y} cx={cx} textAnchor={textAnchor} dominantBaseline="central" className="text-xs font-semibold fill-slate-700">
                                      {payload.value}
                                    </text>
                                  )}
                                onClick={(data) => handleDrillDown(data.name, data.list)}
                            >
                                <Cell fill="#10b981" stroke="#fff" strokeWidth={2}/>
                                <Cell fill="#f59e0b" stroke="#fff" strokeWidth={2}/>
                                <Cell fill="#94a3b8" stroke="#fff" strokeWidth={2}/>
                            </Pie>
                            <RechartsTooltip formatter={(value, name) => [`${value} Accounts`, name]} />
                            <Legend verticalAlign="bottom" height={36} wrapperStyle={{paddingTop: 10}}/>
                        </PieChart>
                    </ResponsiveContainer>
                </div>
                <p className="text-center text-xs text-slate-500 mt-2">Click chart segments to view account lists</p>
            </div>
            
            <div className="space-y-4">
              <div onClick={() => handleDrillDown('Confirmed EV Users', metrics.evConfirmed)} className="bg-white border border-emerald-200 p-6 rounded-xl shadow-sm flex justify-between items-center cursor-pointer hover:bg-emerald-50 transition">
                <div>
                  <h3 className="text-emerald-700 font-bold">Confirmed EVs</h3>
                  <p className="text-emerald-600/70 text-sm">ev_billed is TRUE</p>
                </div>
                <div className="text-3xl font-bold text-emerald-600">{metrics.evConfirmed.length}</div>
              </div>
              <div onClick={() => handleDrillDown('Suspected EV Users', metrics.evSuspected)} className="bg-white border border-amber-200 p-6 rounded-xl shadow-sm flex justify-between items-center cursor-pointer hover:bg-amber-50 transition">
                <div>
                  <h3 className="text-amber-700 font-bold">Suspected EVs</h3>
                  <p className="text-amber-600/70 text-sm">suspected_ev is TRUE</p>
                </div>
                <div className="text-3xl font-bold text-amber-600">{metrics.evSuspected.length}</div>
              </div>
              <div onClick={() => handleDrillDown('No EV Suspected Users', metrics.noEv)} className="bg-white border border-slate-300 p-6 rounded-xl shadow-sm flex justify-between items-center cursor-pointer hover:bg-slate-100 transition">
                <div>
                  <h3 className="text-slate-700 font-bold">No EV Suspected</h3>
                  <p className="text-slate-600/70 text-sm">Not Confirmed or Suspected</p>
                </div>
                <div className="text-3xl font-bold text-slate-700">{metrics.noEv.length}</div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 5: Battery Issues */}
        {activeTab === 'Battery Issues' && (
          <div className="space-y-6 flex-1 flex flex-col">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-white p-4 rounded-xl border shadow-sm flex flex-col justify-center items-center text-center">
                <span className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Total Portfolio</span>
                <span className="text-2xl font-black text-slate-900">{metrics.totalBattery}</span>
                <span className="text-[10px] text-transparent mt-1 select-none">Spacer</span>
              </div>
              <div onClick={() => handleDrillDown('Batteries Setup', metrics.battSetup)} className="bg-white p-4 rounded-xl border border-indigo-200 shadow-sm flex flex-col justify-center items-center cursor-pointer hover:bg-indigo-50 text-center">
                <span className="text-indigo-600 text-xs font-bold uppercase tracking-wider mb-1">Setup</span>
                <span className="text-2xl font-black text-indigo-700">{metrics.battSetup.length}</span>
                <span className="text-[10px] font-semibold text-indigo-500 mt-1">{(metrics.battSetup.length / metrics.totalBattery * 100 || 0).toFixed(1)}% of total</span>
              </div>
              <div onClick={() => handleDrillDown('Batteries Online', metrics.battOnline)} className="bg-white p-4 rounded-xl border border-emerald-200 shadow-sm flex flex-col justify-center items-center cursor-pointer hover:bg-emerald-50 text-center">
                <span className="text-emerald-600 text-xs font-bold uppercase tracking-wider mb-1">Online (Signal OK)</span>
                <span className="text-2xl font-black text-emerald-700">{metrics.battOnline.length}</span>
                <div className="text-[10px] font-semibold text-emerald-600 mt-1 leading-tight">
                    {(metrics.battOnline.length / metrics.battSetup.length * 100 || 0).toFixed(1)}% of setup<br/>
                    <span className="text-emerald-600/70">{(metrics.battOnline.length / metrics.totalBattery * 100 || 0).toFixed(1)}% of total</span>
                </div>
              </div>
              <div onClick={() => handleDrillDown('Batteries Offline', metrics.battOffline)} className="bg-white p-4 rounded-xl border border-red-200 shadow-sm flex flex-col justify-center items-center cursor-pointer hover:bg-red-50 text-center">
                <span className="text-red-600 text-xs font-bold uppercase tracking-wider mb-1">Offline</span>
                <span className="text-2xl font-black text-red-700">{metrics.battOffline.length}</span>
                <div className="text-[10px] font-semibold text-red-500 mt-1 leading-tight">
                    {(metrics.battOffline.length / metrics.battSetup.length * 100 || 0).toFixed(1)}% of setup<br/>
                    <span className="text-red-500/70">{(metrics.battOffline.length / metrics.totalBattery * 100 || 0).toFixed(1)}% of total</span>
                </div>
              </div>
              <div onClick={() => handleDrillDown('Batteries Not Setup', metrics.battNotSetup)} className="bg-white p-4 rounded-xl border border-slate-300 shadow-sm flex flex-col justify-center items-center cursor-pointer hover:bg-slate-100 text-center">
                <span className="text-slate-600 text-xs font-bold uppercase tracking-wider mb-1">Not Setup</span>
                <span className="text-2xl font-black text-slate-700">{metrics.battNotSetup.length}</span>
                <span className="text-[10px] font-semibold text-slate-500 mt-1">{(metrics.battNotSetup.length / metrics.totalBattery * 100 || 0).toFixed(1)}% of total</span>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border shadow-sm flex-1 flex flex-col">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-slate-800">Detailed Site Battery Tracker</h3>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                        <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm"></span> Online</div>
                        <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-red-500 rounded-sm"></span> Offline</div>
                        <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-slate-300 rounded-sm"></span> Not Setup</div>
                    </div>
                </div>
                <div className="overflow-auto border border-slate-100 rounded-lg flex-1">
                    <table className="w-full text-sm text-left whitespace-nowrap">
                        <thead className="bg-slate-50 text-slate-600 sticky top-0 shadow-sm flex-1">
                            <tr>
                                <th className="p-3 font-semibold text-xs uppercase tracking-wider">Site Name</th>
                                <th className="p-3 font-semibold text-xs uppercase tracking-wider text-center">Committed</th>
                                <th className="p-3 font-semibold text-xs uppercase tracking-wider w-1/3">Status Breakdown</th>
                                <th className="p-3 font-semibold text-xs uppercase tracking-wider text-right">Progress</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 flex-1">
                            {metrics.batterySiteSummary.map((site, i) => {
                                const onlinePct = (site.online / site.total) * 100 || 0;
                                let progressBadgeColor = 'bg-red-100 text-red-800'; 
                                if (onlinePct === 100) progressBadgeColor = 'bg-emerald-100 text-emerald-800';
                                else if (onlinePct >= 70) progressBadgeColor = 'bg-orange-100 text-orange-800';
                                else if (onlinePct >= 30) progressBadgeColor = 'bg-amber-100 text-amber-800'; 

                                return (
                                    <tr key={i} className="hover:bg-slate-50 transition flex-1">
                                        <td className="p-3">
                                            <div className="text-sm font-semibold text-slate-800">{site.name}</div>
                                        </td>
                                        <td className="p-3 text-center text-lg font-black text-slate-700">{site.total}</td>
                                        <td className="p-3">
                                            <div className="w-full h-6 flex rounded overflow-hidden bg-slate-100 cursor-pointer shadow-inner relative">
                                                <div 
                                                    className="bg-emerald-500 hover:opacity-85 transition" 
                                                    style={{width: `${(site.online/site.total)*100}%`}} 
                                                    title={`${site.online} Online`}
                                                    onClick={() => handleDrillDown(`${site.name} - Online`, site.onlineData)}
                                                ></div>
                                                <div 
                                                    className="bg-red-500 hover:opacity-85 transition" 
                                                    style={{width: `${(site.offline/site.total)*100}%`}} 
                                                    title={`${site.offline} Offline`}
                                                    onClick={() => handleDrillDown(`${site.name} - Offline`, site.offlineData)}
                                                ></div>
                                                <div 
                                                    className="bg-slate-300 hover:opacity-85 transition" 
                                                    style={{width: `${(site.notSetup/site.total)*100}%`}} 
                                                    title={`${site.notSetup} Not Setup`}
                                                    onClick={() => handleDrillDown(`${site.name} - Not Setup`, site.notSetupData)}
                                                ></div>
                                            </div>
                                        </td>
                                        <td className="p-3 text-right">
                                            <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold ${progressBadgeColor}`}>
                                                {onlinePct.toFixed(1)}%
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
          </div>
        )}

        {/* Tab 6: Missing MPANs */}
        {activeTab === 'Missing MPANs' && (
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden flex flex-col flex-1">
            <div className="p-6 border-b flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">Missing Export MPANs & Issues</h2>
              
              <div className="flex gap-2">
                <select 
                  value={mpanTypeFilter} 
                  onChange={e => setMpanTypeFilter(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="All">All Types</option>
                  <option value="Developer">Developer Only</option>
                  <option value="Customer">Customer Only</option>
                </select>
                <button onClick={() => handleDrillDown('All Missing MPANs', metrics.missingMpans)} className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 transition flex items-center gap-1.5 shadow-sm">View Extracted List</button>
              </div>
            </div>
            
            <div className="overflow-auto p-4 flex-1">
              <table className="w-full text-sm text-left flex-1 whitespace-nowrap">
                <thead className="bg-slate-100 text-slate-600 sticky top-0 shadow-sm flex-1">
                  <tr>
                    <th className="p-3">Account</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Address</th>
                    <th className="p-3">Site</th>
                    <th className="p-3">Import Energisation</th>
                    <th className="p-3">Export Energisation</th>
                    <th className="p-3 bg-red-50 text-red-800 rounded-tr-lg">Detected Issue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 flex-1">
                  {metrics.missingMpans
                    .filter(r => mpanTypeFilter === 'All' || String(r.account_type).toLowerCase() === mpanTypeFilter.toLowerCase())
                    .map((r, i) => {
                      const impDen = String(r.import_energisation_status).toLowerCase() === 'denergised';
                      const expDen = String(r.export_energisation_status).toLowerCase() === 'denergised';
                      return (
                        <tr key={i} className="hover:bg-slate-50 flex-1">
                          <td className="p-3 font-medium text-slate-900">{r.latest_account_number_for_address || r.import_mpan}</td>
                          <td className="p-3 capitalize">{r.account_type}</td>
                          <td className="p-3">{getAddress(r)}</td>
                          <td className="p-3 font-medium text-indigo-700 max-w-[150px] truncate" title={r.site_name}>{r.site_name}</td>
                          <td className={`p-3 ${impDen ? 'text-red-600 font-bold' : ''}`}>{r.import_energisation_status}</td>
                          <td className={`p-3 ${expDen ? 'text-red-600 font-bold' : ''}`}>{r.export_energisation_status}</td>
                          <td className="p-3 text-xs font-semibold text-red-600 bg-red-50/30">
                            Missing Export MPAN
                          </td>
                        </tr>
                      );
                  })}
                  {metrics.missingMpans.length === 0 && <tr><td colSpan="8" className="p-10 text-center text-slate-500">All filtered accounts have an Export MPAN.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 7: Missing Smart Reads */}
        {activeTab === 'Missing Smart Reads' && (
          <div className="bg-white border rounded-xl shadow-sm p-6 flex-1 flex flex-col">
             <div className="mb-6 flex justify-between items-center border-b pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Accounts with Missing Smart Reads</h2>
                <p className="text-sm text-slate-500 mt-1">Checking both import and export dates. Flagged if last read is over 3 days old.</p>
              </div>
            </div>

            {metrics.missingSmartReads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-emerald-600 bg-emerald-50 rounded-xl border border-emerald-100 flex-1">
                <Smile size={80} className="mb-6 text-emerald-500"/>
                <h2 className="text-3xl font-black">All smart meters online!</h2>
                <p className="text-emerald-700/80 mt-2 font-medium">No smart read data is missing or stale.</p>
              </div>
            ) : (
              <div className="overflow-auto border border-slate-100 rounded-lg flex-1">
                <table className="w-full text-sm text-left flex-1 whitespace-nowrap">
                  <thead className="bg-slate-50 text-slate-600 sticky top-0 shadow-sm flex-1">
                    <tr>
                      <th className="p-3">Account</th>
                      <th className="p-3">Type</th>
                      <th className="p-3">Address</th>
                      <th className="p-3">Site</th>
                      <th className="p-3 text-center">Import Last Read</th>
                      <th className="p-3 text-center">Export Last Read</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 flex-1">
                    {metrics.missingSmartReads.map((r, i) => {
                      const hasImport = hasValidMpan(r.import_mpan);
                      const hasExport = hasValidMpan(r.export_mpan);

                      const impStale = hasImport && isDateStale(r.import_last_smart_read_date);
                      const expStale = hasExport && isDateStale(r.export_last_smart_read_date);
                      
                      return (
                        <tr key={i} className="hover:bg-slate-50 flex-1">
                          <td className="p-3 font-medium text-slate-900">{r.latest_account_number_for_address || r.import_mpan}</td>
                          <td className="p-3 capitalize">{r.account_type}</td>
                          <td className="p-3">{getAddress(r)}</td>
                          <td className="p-3 font-medium text-indigo-700 max-w-[150px] truncate" title={r.site_name}>{r.site_name}</td>
                          
                          <td className={`p-3 text-center font-semibold ${impStale ? 'text-red-600 bg-red-50' : (!hasImport ? 'text-slate-400 italic' : '')}`}>
                            {hasImport ? (r.import_last_smart_read_date || 'Missing') : 'No MPAN'}
                          </td>
                          <td className={`p-3 text-center font-semibold ${expStale ? 'text-red-600 bg-red-50' : (!hasExport ? 'text-slate-400 italic' : '')}`}>
                            {hasExport ? (r.export_last_smart_read_date || 'Missing') : 'No MPAN'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>
      <DrillDownModal />
    </div>
  );
}
