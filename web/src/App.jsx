import { useEffect, useState } from 'react';
import { getSession, setSession, getRegion, setRegion, REGIONS, goLogin } from './api.js';
import Login from './components/Login.jsx';
import Explore from './components/Explore.jsx';
import PollPage from './components/PollPage.jsx';
import CreatePoll from './components/CreatePoll.jsx';
import MyPolls from './components/MyPolls.jsx';
import Dashboard from './components/Dashboard.jsx';
import SystemPanel from './components/SystemPanel.jsx';

// Hash router: #/  #/polls/:id  #/create  #/mine  #/dashboard  #/login?next=...
function parseRoute() {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = hash.split('?');
  const params = new URLSearchParams(query);
  const poll = path.match(/^\/polls\/([0-9a-f-]{36})/i);
  if (poll) return { name: 'poll', pollId: poll[1] };
  if (path.startsWith('/create')) return { name: 'create', auth: true };
  if (path.startsWith('/mine')) return { name: 'mine', auth: true };
  if (path.startsWith('/dashboard')) return { name: 'dashboard' };
  if (path.startsWith('/login')) return { name: 'login', next: params.get('next') || '/' };
  return { name: 'explore' };
}

function useRoute() {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function useSession() {
  const [session, set] = useState(getSession);
  useEffect(() => {
    const on = () => set(getSession());
    window.addEventListener('pollpulse:session', on);
    return () => window.removeEventListener('pollpulse:session', on);
  }, []);
  return session;
}

function RegionPicker() {
  const [region, set] = useState(getRegion);
  return (
    <label className="region-picker" title="Which region your votes come from (simulated)">
      <span className="muted small">Voting from</span>
      <select
        value={region}
        onChange={(e) => {
          setRegion(e.target.value);
          set(e.target.value);
        }}
      >
        {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
    </label>
  );
}

export default function App() {
  const route = useRoute();
  const session = useSession();

  useEffect(() => {
    if (route.auth && !session) goLogin();
  }, [route, session]);

  let page;
  if (route.name === 'login') page = <Login next={route.next} />;
  else if (route.auth && !session) page = null;
  else if (route.name === 'poll') page = <PollPage key={route.pollId} pollId={route.pollId} session={session} />;
  else if (route.name === 'create') page = <CreatePoll />;
  else if (route.name === 'mine') page = <MyPolls />;
  else if (route.name === 'dashboard') page = <Dashboard />;
  else page = <Explore />;

  const nav = (name, href, label) => (
    <a href={href} className={route.name === name ? 'active' : ''}>{label}</a>
  );

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32"><path d="M5 17h5l3-7 5 13 3-6h6" /></svg>
          </span>
          PollPulse
        </a>
        <nav className="nav">
          {nav('explore', '#/', 'Explore')}
          {nav('create', '#/create', 'Create')}
          {session && nav('mine', '#/mine', 'My polls')}
          {nav('dashboard', '#/dashboard', 'Dashboard')}
        </nav>
        <div className="topbar-right">
          <RegionPicker />
          {session ? (
            <button className="ghost small" onClick={() => setSession(null)} title={`Sign out ${session.user.email}`} aria-label="Sign out">
              <span className="avatar">{session.user.name.slice(0, 1).toUpperCase()}</span>
              <span className="signout-label">Sign out</span>
            </button>
          ) : (
            <button className="primary small" onClick={goLogin}>Sign in</button>
          )}
        </div>
      </header>
      <main className="main">{page}</main>
      <footer className="footer">
        System Design Project 2 · SQL vs NoSQL · Sharding · Replication · Consistency · CAP
      </footer>
      {route.name !== 'dashboard' && <SystemPanel />}
    </div>
  );
}
