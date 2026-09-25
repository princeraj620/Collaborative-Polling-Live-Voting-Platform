import { useState } from 'react';
import { api } from '../api.js';

const CATEGORIES = ['general', 'tech', 'food', 'travel', 'sports', 'entertainment', 'lifestyle'];
const DURATIONS = [
  { v: 5, l: '5 minutes' },
  { v: 60, l: '1 hour' },
  { v: 1440, l: '1 day' },
  { v: 10080, l: '1 week' },
];

export default function CreatePoll() {
  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [duration, setDuration] = useState(60);
  const [category, setCategory] = useState('general');
  const [visibility, setVisibility] = useState('public');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const setOption = (i, v) => setOptions((o) => o.map((x, j) => (j === i ? v : x)));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const opts = options.map((o) => o.trim());
    if (question.trim().length < 5) return setError('The question needs at least 5 characters.');
    if (opts.some((o) => !o)) return setError('Fill in every option, or remove the empty ones.');
    if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return setError('Options must be different.');
    setBusy(true);
    try {
      const { poll } = await api.create({ question, description, options: opts, durationMinutes: duration, category, visibility });
      window.location.hash = `/polls/${poll.id}`;
    } catch (err) {
      setError(err.status === 429 ? `You're creating polls too fast. Try again in ${err.retryAfter}s.` : err.message);
      setBusy(false);
    }
  };

  return (
    <section className="create">
      <div className="section-head">
        <h1>Create a poll</h1>
        <p className="muted">Saved to the PostgreSQL <strong>primary</strong>. Your "My polls" page then uses read-your-writes, so you see it straight away even though the replica is a moment behind.</p>
      </div>
      <form className="card create-form" onSubmit={submit} noValidate>
        <label>
          Question
          <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} placeholder="What should we have for the team lunch?" />
        </label>
        <label>
          Description <span className="muted">(optional)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="Any context voters should know" />
        </label>
        <div className="options-edit">
          <span className="label">Options</span>
          {options.map((o, i) => (
            <div key={i} className="option-row">
              <span className="vote-letter">{String.fromCharCode(65 + i)}</span>
              <input value={o} onChange={(e) => setOption(i, e.target.value)} maxLength={60} placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1}`} />
              {options.length > 2 && (
                <button type="button" className="icon" aria-label={`Remove option ${i + 1}`} onClick={() => setOptions((x) => x.filter((_, j) => j !== i))}>×</button>
              )}
            </div>
          ))}
          {options.length < 6 && (
            <button type="button" className="ghost small" onClick={() => setOptions((x) => [...x, ''])}>+ Add option</button>
          )}
        </div>
        <div className="form-row">
          <label>
            Closes after
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
            </select>
          </label>
          <label>
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>
            Visibility
            <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              <option value="public">Public</option>
              <option value="unlisted">Unlisted (link only)</option>
            </select>
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="primary block" disabled={busy}>{busy ? 'Creating…' : 'Create poll'}</button>
      </form>
    </section>
  );
}
