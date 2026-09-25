import { useState } from 'react';
import { api, setSession } from '../api.js';

export default function Login({ next }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Enter your name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Enter a valid email');
    setBusy(true);
    try {
      setSession(await api.login(email, name));
      window.location.hash = next || '/';
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">System Design · Project 2</p>
        <h1>
          Millions of votes.
          <br />
          <span className="accent">Counted exactly once.</span>
        </h1>
        <p className="lede">
          A live voting platform where votes are sharded across a MongoDB cluster, polls live in
          PostgreSQL with a read replica, and results stream to every screen once a second.
        </p>
        <ul className="hero-points">
          <li>Vote twice and see it counted once</li>
          <li>Create a poll and watch read-your-writes in action</li>
          <li>Open the dashboard to watch shards, replicas and votes per second</li>
        </ul>
      </div>
      <form className="card login" onSubmit={submit} noValidate>
        <h2>Sign in to vote</h2>
        <p className="muted">Demo sign-in. No password needed.</p>
        <label>
          Name
          <input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} placeholder="Asha" autoFocus />
        </label>
        <label>
          Email
          <input value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} placeholder="asha@example.com" type="email" />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary block" disabled={busy}>{busy ? 'Signing in…' : 'Continue'}</button>
      </form>
    </section>
  );
}
