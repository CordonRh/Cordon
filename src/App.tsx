import {useEffect} from 'react';
import {HomeView} from '@/views/home';
import {Dashboard} from '@/views/dashboard';
import {InfoPage} from '@/views/info';
import {sections,labels,type Section} from '@/views/dashboard/model';
import {ScrollLayout} from '@/layouts/scroll-layout';
import {ReducedMotion} from '@/components/common/reduced-motion';
import {Brand} from '@/components/cordon/shared';
import {usePathname} from '@/components/compat/navigation';
export function App(){const path=usePathname().replace(/\/$/,'')||'/';const section=path.split('/')[2] as Section;const info=path.slice(1);useEffect(()=>{document.title=path==='/'?'Cordon — Confidential asset servicing':`${path.startsWith('/dashboard')?(labels[section]||'Workspace'):info[0]?.toUpperCase()+info.slice(1)} — Cordon`;if(path!=='/')delete document.documentElement.dataset.preload;},[path,section,info]);let page;if(path==='/')page=<HomeView/>;else if(path==='/dashboard')page=<Dashboard/>;else if(path.startsWith('/dashboard/')&&sections.includes(section))page=<Dashboard section={section}/>;else if(['docs','about','privacy','terms','cookies'].includes(info))page=<InfoPage slug={info}/>;else page=<div className="info-page"><header className="info-header"><Brand/></header><main className="info-body"><p className="eyebrow">404</p><h1>Outside the cordon.</h1><p className="info-lead">That page could not be found.</p><a href="/" className="primary-btn">Return home</a></main></div>;return <ScrollLayout><ReducedMotion/>{page}</ScrollLayout>}
