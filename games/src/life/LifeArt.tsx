import { vehicleType } from './visualState'

export function VehicleIllustration({ assets, size = 'small' }: { assets: string[]; size?: 'small' | 'wide' }) {
  const kind = vehicleType(assets)
  if (kind === 'none') return null
  return <svg className={'life-vehicle life-vehicle--' + size} viewBox="0 0 280 120" aria-hidden="true">
    <path d="M0 101h280" stroke="var(--art-trim)" strokeWidth="3" />
    {kind === 'bike' ? <g stroke="var(--art-ink)" strokeWidth="4" fill="none"><circle cx="68" cy="83" r="25"/><circle cx="207" cy="83" r="25"/><path d="M68 83l52-54 33 54H68l52-54m33 54l54-61M105 24h30m59-6h23" strokeLinecap="round"/><circle cx="153" cy="83" r="5" fill="#d58d68"/></g> : <g><path d="M34 70l18-12 29-32q8-9 20-9h89q12 0 20 12l23 29 14 10v22H30V77q0-5 4-7z" fill={kind === 'premium' ? '#495c68' : kind === 'reliable' ? '#789a9a' : '#bd8b70'} stroke="var(--art-ink)" strokeWidth="3" /><path d="M84 28h102q7 0 12 7l17 23H63z" fill="#a8c6cf" stroke="var(--art-ink)" strokeWidth="2" /><path d="M141 27v31" stroke="#657d87" strokeWidth="3"/><circle cx="75" cy="89" r="17" fill="#28333a"/><circle cx="75" cy="89" r="8" fill="#bac1bd"/><circle cx="210" cy="89" r="17" fill="#28333a"/><circle cx="210" cy="89" r="8" fill="#bac1bd"/><path d="M33 71h18m184 0h11" stroke="#ead9bd" strokeWidth="5" strokeLinecap="round" /></g>}
  </svg>
}

export function EventIllustration({ severity, id }: { severity: string; id: string }) {
  const career = /career|job|interview|office|boss/.test(id)
  const home = /home|family|social|friend|date/.test(id)
  const health = /health|ill|burn|stress|hospital/.test(id)
  return <div className="life-event-art" data-severity={severity} aria-hidden="true"><svg viewBox="0 0 360 150"><rect width="360" height="150" fill="var(--art-wall)" /><path d="M0 124h360v26H0z" fill="var(--art-floor)" />
    <circle cx="84" cy="73" r="34" fill={health ? '#c7ddcf' : home ? '#e3c4ae' : '#b8d2d4'} />
    {health ? <><path d="M84 54v38M65 73h38" stroke="#4c8771" strokeWidth="9" strokeLinecap="round" /><rect x="189" y="69" width="117" height="49" rx="6" fill="#f0e8df"/><path d="M197 95h102" stroke="#aab6aa" strokeWidth="5" /></> : career ? <><rect x="52" y="54" width="64" height="48" rx="3" fill="#667f8a"/><path d="M61 65h45M61 75h29" stroke="#b3d0ca" strokeWidth="4"/><rect x="178" y="67" width="130" height="55" rx="4" fill="#849c9a"/><path d="M191 82h102M191 94h68" stroke="#d9e5de" strokeWidth="4" /></> : home ? <><path d="M50 83l34-32 34 32v41H50z" fill="#cf927a"/><rect x="81" y="93" width="20" height="31" fill="#f0e6d8"/><circle cx="236" cy="78" r="24" fill="#d2a88c"/><path d="M210 122q26-35 52 0" fill="#73918b" /></> : <><path d="M65 52h39v54H65z" fill="#7d9ca0"/><path d="M72 66h24M72 76h24M72 86h15" stroke="#dce5df" strokeWidth="4" /><circle cx="244" cy="83" r="38" fill="#e1c7a2" /><path d="M227 94l16-30 11 19 12-25" stroke="#7c856c" strokeWidth="5" fill="none" /></>}
  </svg></div>
}

const glyphPaths: Record<string, string> = {
  sales: 'M5 20V9l7-4 7 4v11M5 12h14M9 15h6', marketing: 'M4 12h5l9-5v10l-9-5H4zM9 15l2 5', product: 'M5 5h14v14H5zM9 5v14M5 11h14', technology: 'M8 5L3 12l5 7M16 5l5 7-5 7M14 4l-4 16', operations: 'M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M11 16v4', finance: 'M4 19h16M7 16v-5M12 16V6M17 16V9', people: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-5 3-8 8-8s8 3 8 8', legal: 'M12 3v18M5 7h14M4 16l3-7 3 7zM14 16l3-7 3 7zM8 21h8', international: 'M3 12h18M12 3c-5 4-5 14 0 18M12 3c5 4 5 14 0 18M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0z',
  device: 'M3 5h18v12H3zM8 21h8M12 17v4', transport: 'M4 15l2-6h12l2 6v4H4zM7 19v2M17 19v2', wardrobe: 'M9 5l3 3 3-3 4 3-2 13H7L5 8z', health: 'M12 3v18M3 12h18', home: 'M3 11l9-8 9 8v10H3zM9 21v-7h6v7', study: 'M3 5h8v15H3zM13 5h8v15h-8zM11 7l2-2', business: 'M4 21V8h16v13M8 8V4h8v4M8 12h2M14 12h2M8 16h2M14 16h2',
  consulting: 'M5 4h14v16H5zM8 9h8M8 13h6M8 17h4', subscription: 'M12 3a9 9 0 1 1-8 5M4 3v5h5M12 8v5l3 2', b2b: 'M3 9h7v12H3zM14 5h7v16h-7zM10 14h4', consumer: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2', platform: 'M3 5h7v6H3zM14 5h7v6h-7zM8 15h8v6H8zM7 11v4h10v-4', enterprise: 'M4 20V7h16v13M8 7V3h8v4M8 12h2M14 12h2M8 16h2M14 16h2', infrastructure: 'M3 18h18M6 18V7l6-4 6 4v11M9 10h6M9 14h6', research: 'M8 3h8M10 3v7l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3M8 16h8',
  data_basic: 'M4 18l5-6 4 3 7-9M4 21h16', sql: 'M4 6c0-4 16-4 16 0s-16 4-16 0zM4 6v12c0 4 16 4 16 0V6M4 12c0 4 16 4 16 0', finance_modeling: 'M4 19h16M7 16v-4M12 16V7M17 16V4', project: 'M5 4h14v16H5zM8 8h8M8 12h6M8 16h4', leadership: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c0-5 3-8 8-8s8 3 8 8', strategy: 'M4 19l5-8 4 3 7-10M4 5v14h16', board: 'M4 10h16v10H4zM8 10V5h8v5M8 15h8',
}

export function LifeGlyph({ name, size = 24 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={glyphPaths[name] ?? glyphPaths.product} /></svg>
}

const regionPoints: Record<string, [number, number]> = { home: [311, 102], country: [332, 95], europe: [289, 103], asia: [408, 108], middle_east: [346, 149], north_america: [113, 98], latam: [167, 190], africa: [329, 193] }

export function MarketMap({ regions, catalog, activeRegion }: { regions: string[]; catalog: { id: string; title: string }[]; activeRegion?: string }) {
  return <div className="life-market-map" role="img" aria-label={'Рынки: ' + (catalog.filter((item) => regions.includes(item.id)).map((item) => item.title).join(', ') || 'домашний')}><svg viewBox="0 0 600 270" aria-hidden="true"><rect width="600" height="270" fill="var(--art-sky)" />
    <g fill="var(--art-map-land)" stroke="var(--art-map-line)" strokeWidth="2" strokeLinejoin="round"><path d="M44 75l45-28 68 9 29 25-18 26-25 3-11 31-40 7-22-25-29-4z"/><path d="M138 145l38 8 23 36-11 55-25 21-25-32 4-30-15-24z"/><path d="M252 78l43-31 41 15 36-12 53 18 67-6 63 36-12 35-40 11-28-23-45 24-50-11-13 28-35-6-13-37-45 7-17-24z"/><path d="M296 146l47-9 31 23-2 52-33 42-28-13-15-42z"/><path d="M480 208l35-14 44 13 12 30-50 14-45-15z"/></g>
    {catalog.map((region) => { const [x, y] = regionPoints[region.id] ?? [300, 130]; const open = regions.includes(region.id); const active = activeRegion === region.id; return <g key={region.id}><circle cx={x} cy={y} r={active ? 12 : open ? 9 : 6} fill={open ? 'var(--art-map-active)' : 'var(--art-sky)'} stroke="var(--art-map-active)" strokeWidth="2" strokeDasharray={active ? '3 2' : undefined} /><title>{region.title}: {open ? 'открыт' : active ? 'выход на рынок' : 'закрыт'}</title></g> })}
  </svg></div>
}
