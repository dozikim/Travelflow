import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { BarChart3, CalendarDays, CheckCircle2, CircleDollarSign, ClipboardList, Compass, Copy, Edit3, FileText, Home, LogOut, MapPin, Menu, MessageSquareText, NotebookPen, Plus, Search, Settings, Share2, Sparkles, Trash2, UserRound } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import './styles.css';

const API = '/api';
const AuthContext = createContext(null);
const palette = ['#0d5c63', '#d69332', '#9f6b4b', '#78a083'];

async function request(path, options = {}) {
  const token = localStorage.getItem('traveloop_token');
  const method = (options.method || 'GET').toUpperCase();
  const { _csrfRetry, ...fetchOptions } = options;
  let csrfToken = sessionStorage.getItem('traveloop_csrf');
  if (!csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrfRes = await fetch(`${API}/security/csrf`, { credentials: 'include' });
    csrfToken = (await csrfRes.json()).csrfToken;
    sessionStorage.setItem('traveloop_csrf', csrfToken);
  }
  const res = await fetch(`${API}${path}`, {
    ...fetchOptions,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(fetchOptions.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.error?.toLowerCase().includes('csrf') && !_csrfRetry) {
    sessionStorage.removeItem('traveloop_csrf');
    return request(path, { ...options, _csrfRetry: true });
  }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function AuthProvider({ children }) {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('traveloop_user') || 'null'));
  useEffect(() => {
    if (!localStorage.getItem('traveloop_token')) return;
    request('/me').then((fresh) => {
      localStorage.setItem('traveloop_user', JSON.stringify(fresh));
      setUser(fresh);
    }).catch(() => {});
  }, []);
  const login = (payload) => {
    localStorage.setItem('traveloop_token', payload.token);
    localStorage.setItem('traveloop_user', JSON.stringify(payload.user));
    setUser(payload.user);
  };
  const logout = () => {
    request('/auth/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('traveloop_token');
    localStorage.removeItem('traveloop_user');
    sessionStorage.removeItem('traveloop_csrf');
    setUser(null);
  };
  return <AuthContext.Provider value={{ user, setUser, login, logout }}>{children}</AuthContext.Provider>;
}

const useAuth = () => useContext(AuthContext);
const page = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -10 }, transition: { duration: 0.22 } };

function Protected({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

function AdminProtected({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return user.role === 'admin' ? children : <Navigate to="/" replace />;
}

function Shell({ children }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const baseNav = [
    [Home, 'Home', '/'],
    [Compass, 'My Trips', '/trips'],
    [Plus, 'Create', '/create'],
    [Search, 'Cities', '/cities'],
    [Sparkles, 'Activities', '/activities'],
    [MessageSquareText, 'Community', '/community'],
    [FileText, 'Invoices', '/invoices'],
    [Settings, 'Settings', '/settings']
  ];
  const nav = user?.role === 'admin' ? [...baseNav.slice(0, -1), [BarChart3, 'Admin', '/admin'], baseNav.at(-1)] : baseNav;
  return (
    <div className="shell">
      <aside className={open ? 'sidebar open' : 'sidebar'}>
        <div className="brand"><span>TL</span><strong>Traveloop</strong></div>
        <nav>{nav.map(([Icon, label, to]) => <NavLink key={to} to={to} onClick={() => setOpen(false)}><Icon size={18} />{label}</NavLink>)}</nav>
        <button className="ghost logout" onClick={logout}><LogOut size={18} />Sign out</button>
      </aside>
      <main>
        <header className="topbar">
          <button className="icon mobile-only" onClick={() => setOpen(!open)}><Menu /></button>
          <div><span className="eyebrow">Good journey,</span><h2>{user?.name || 'Traveler'}</h2></div>
          <div className="profile-menu">
            <button className="avatar profile-button" onClick={() => setProfileOpen(!profileOpen)} aria-label="Open profile and privileges">{user?.photo_url ? <img src={user.photo_url} alt="" /> : <UserRound />}</button>
            {profileOpen && <div className="profile-popover">
              <div className="profile-popover-head">
                <div className="avatar">{user?.photo_url ? <img src={user.photo_url} alt="" /> : <UserRound />}</div>
                <div><strong>{user?.name}</strong><span>{user?.email}</span></div>
              </div>
              <div className="privilege-pill">{user?.role || 'traveler'} · {user?.staff_status || 'active'}</div>
              <p>{user?.privilege_notes || 'Can plan trips and manage personal travel data.'}</p>
              <NavLink to="/settings" onClick={() => setProfileOpen(false)}>View profile details</NavLink>
              {user?.role === 'admin' && <NavLink to="/admin" onClick={() => setProfileOpen(false)}>Manage staff privileges</NavLink>}
              <button onClick={logout}><LogOut size={16} />Sign out</button>
            </div>}
          </div>
        </header>
        <AnimatePresence mode="wait">{children}</AnimatePresence>
      </main>
    </div>
  );
}

function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', firstName: '', lastName: '', email: '', password: '', newPassword: '', resetToken: '', phone: '', city: '', country: '', photo_url: '', additional: '', captcha: '' });
  const [captcha, setCaptcha] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (mode === 'login') request('/security/captcha').then((data) => setCaptcha(data.question)).catch(() => setCaptcha(''));
  }, [mode]);
  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      if (mode === 'forgot') {
        const data = await request('/auth/forgot', { method: 'POST', body: JSON.stringify({ email: form.email }) });
        setMessage(data.message);
        return;
      }
      if (mode === 'reset') {
        await request('/auth/reset', { method: 'POST', body: JSON.stringify({ token: form.resetToken, password: form.newPassword }) });
        setMessage('Password reset complete. You can sign in now.');
        setMode('login');
        return;
      }
      const data = await request(`/auth/${mode}`, { method: 'POST', body: JSON.stringify({ ...form, name: `${form.firstName || ''} ${form.lastName || ''}`.trim() || form.name }) });
      login(data);
      navigate('/');
    } catch (err) { setError(err.message); }
  }
  return (
    <div className="auth-screen">
      <motion.section {...page} className="auth-card">
        <div className="brand big"><span>TL</span><strong>Traveloop</strong></div>
        <h1>{mode === 'signup' ? 'Start your next beautiful loop.' : mode === 'forgot' || mode === 'reset' ? 'Reset your route.' : 'Welcome back.'}</h1>
        <p>Plan layered itineraries, budgets, notes, and packing lists in one calm travel workspace.</p>
        <form onSubmit={submit}>
        {mode === 'signup' && <div className="registration-grid">
          <Field label="First Name" value={form.firstName} onChange={(firstName) => setForm({ ...form, firstName })} />
          <Field label="Last Name" value={form.lastName} onChange={(lastName) => setForm({ ...form, lastName })} />
          <Field label="Phone Number" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
          <Field label="City" value={form.city} onChange={(city) => setForm({ ...form, city })} />
          <Field label="Country" value={form.country} onChange={(country) => setForm({ ...form, country })} />
          <Field label="Photo URL" value={form.photo_url} onChange={(photo_url) => setForm({ ...form, photo_url })} />
          <Field label="Additional Information" textarea value={form.additional} onChange={(additional) => setForm({ ...form, additional })} />
        </div>}
          <Field label="Email" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
          {mode !== 'forgot' && mode !== 'reset' && <Field label="Password" type="password" value={form.password} onChange={(password) => setForm({ ...form, password })} />}
          {mode === 'login' && <Field label={`CAPTCHA: ${captcha || 'loading...'}`} value={form.captcha} onChange={(captchaValue) => setForm({ ...form, captcha: captchaValue })} />}
          {mode === 'reset' && <>
            <Field label="Reset token" value={form.resetToken} onChange={(resetToken) => setForm({ ...form, resetToken })} />
            <Field label="New password" type="password" value={form.newPassword} onChange={(newPassword) => setForm({ ...form, newPassword })} />
          </>}
          {error && <div className="alert danger">{error}</div>}
          {message && <div className="alert">{message}</div>}
          <button className="primary">{mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Reset password' : 'Sign in'}</button>
        </form>
        <div className="auth-links">
          <button onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}>{mode === 'signup' ? 'I already have an account' : 'Create account'}</button>
          <button onClick={() => setMode('forgot')}>Forgot password?</button>
          <button onClick={() => setMode('reset')}>Have reset token?</button>
        </div>
      </motion.section>
      <section className="auth-art"><img src="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=80" alt="" /></section>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', textarea = false }) {
  return <label className="field"><span>{label}</span>{textarea ? <textarea value={value} onChange={(e) => onChange(e.target.value)} /> : <input type={type} value={value} onChange={(e) => onChange(e.target.value)} required />}</label>;
}

function Dashboard() {
  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');
  const [groupBy, setGroupBy] = useState('region');
  const [sortBy, setSortBy] = useState('popularity');
  useEffect(() => { request('/dashboard').then(setData); }, []);
  if (!data) return <Loader />;
  const spent = Number(data.budget.spent || 0);
  const total = Number(data.budget.total || 1);
  const recommended = [...data.recommended]
    .filter((city) => `${city.city} ${city.country} ${city.region}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sortBy === 'cost' ? a.costIndex - b.costIndex : b.popularity - a.popularity);
  return <motion.div {...page} className="page-grid">
    <section className="hero-panel">
      <div><span className="eyebrow">Trip command center</span><h1>Shape the next escape without losing the small details.</h1></div>
      <NavLink to="/create" className="primary inline"><Plus size={18} />Plan New Trip</NavLink>
    </section>
    <section className="panel wide"><Header title="Recent Trips" action={<NavLink to="/trips">View all</NavLink>} /><TripRow trips={data.trips} /></section>
    <section className="panel"><Header title="Budget Highlights" /><div className="budget-meter"><strong>${spent.toLocaleString()}</strong><span>spent of ${total.toLocaleString()}</span><div><i style={{ width: `${Math.min(100, (spent / total) * 100)}%` }} /></div></div></section>
    <section className="panel wide"><Header title="Top Regional Selections" subtitle={`Grouped by ${groupBy}`} /><div className="filters landing-filters"><input placeholder="Search bar..." value={query} onChange={(e) => setQuery(e.target.value)} /><select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}><option value="region">Group by region</option><option value="country">Group by country</option></select><select value={sortBy} onChange={(e) => setSortBy(e.target.value)}><option value="popularity">Sort by popularity</option><option value="cost">Sort by cost</option></select></div><div className="destination-grid">{recommended.map((c) => <Destination key={c.city} city={c} />)}</div></section>
  </motion.div>;
}

function TripRow({ trips }) {
  if (!trips.length) return <Empty text="No trips yet. Your first itinerary is one button away." />;
  return <div className="trip-row">{trips.map((trip) => <NavLink to={`/trips/${trip.id}`} className="trip-card" key={trip.id}><img src={trip.cover_photo || 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=900&q=80'} alt="" /><div><h3>{trip.name}</h3><p>{trip.start_date} to {trip.end_date}</p></div></NavLink>)}</div>;
}

function Destination({ city }) {
  return <article className="destination"><img src={city.image} alt="" /><div><h3>{city.city}</h3><p>{city.country}</p><span>{city.region} · Cost {city.costIndex}</span></div></article>;
}

function CreateTrip() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: 'Autumn Portugal Loop', place: 'Lisbon, Portugal', start_date: format(new Date(), 'yyyy-MM-dd'), end_date: format(addDays(new Date(), 8), 'yyyy-MM-dd'), description: 'Slow mornings, coastal trains, tile workshops, and neighborhood dinners.', cover_photo: 'https://images.unsplash.com/photo-1548707309-dcebeab9ea9b?auto=format&fit=crop&w=1400&q=80' });
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    try {
      const trip = await request('/trips', { method: 'POST', body: JSON.stringify(form) });
      navigate(`/trips/${trip.id}`);
    } catch (err) { setError(err.message); }
  }
  const suggestions = ['Tile atelier walk', 'Coastal train day', 'Food market tour', 'Sunset viewpoint'];
  return <motion.section {...page} className="panel form-panel"><Header title="Plan a New Trip" subtitle="Select a place, set dates, then add sections for travel, hotel, and activities." /><form onSubmit={submit} className="form-grid">
    <Field label="Trip name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
    <Field label="Select a Place" value={form.place} onChange={(place) => setForm({ ...form, place })} />
    <Field label="Start date" type="date" value={form.start_date} onChange={(start_date) => setForm({ ...form, start_date })} />
    <Field label="End date" type="date" value={form.end_date} onChange={(end_date) => setForm({ ...form, end_date })} />
    <Field label="Cover photo URL" value={form.cover_photo} onChange={(cover_photo) => setForm({ ...form, cover_photo })} />
    <Field label="Description" textarea value={form.description} onChange={(description) => setForm({ ...form, description })} />
    <div className="suggestion-strip">{suggestions.map((item) => <span key={item}>{item}</span>)}<button type="button">Add another Section</button></div>
    {error && <div className="alert danger">{error}</div>}
    <button className="primary">Save trip</button>
  </form></motion.section>;
}

function MyTrips() {
  const [trips, setTrips] = useState([]);
  useEffect(() => { request('/trips').then(setTrips); }, []);
  async function remove(id) {
    const previous = trips;
    setTrips(trips.filter((trip) => trip.id !== id));
    try { await request(`/trips/${id}`, { method: 'DELETE' }); } catch { setTrips(previous); }
  }
  const today = format(new Date(), 'yyyy-MM-dd');
  const groups = {
    Ongoing: trips.filter((trip) => trip.start_date <= today && trip.end_date >= today),
    'Up-coming': trips.filter((trip) => trip.start_date > today),
    Completed: trips.filter((trip) => trip.end_date < today)
  };
  return <motion.section {...page} className="panel"><Header title="User Trip Listing" subtitle="Ongoing, upcoming, and completed trips with a short overview." action={<NavLink className="primary inline" to="/create"><Plus size={18} />New</NavLink>} />{Object.entries(groups).map(([label, rows]) => <div className="trip-group" key={label}><h3>{label}</h3><div className="cards">{rows.map((trip) => <article className="card" key={trip.id}><img src={trip.cover_photo || 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=900&q=80'} alt="" /><h3>{trip.name}</h3><p>{trip.description || 'Short overview of the trip.'}</p><span>{trip.start_date} to {trip.end_date} · {trip.destination_count || 0} destinations</span><div className="actions"><NavLink to={`/trips/${trip.id}`}><Edit3 size={17} />View</NavLink><button onClick={() => remove(trip.id)}><Trash2 size={17} />Delete</button></div></article>)}</div>{!rows.length && <p className="muted-line">No {label.toLowerCase()} trips.</p>}</div>)}</motion.section>;
}

function TripWorkspace() {
  const { id } = useParams();
  const [trip, setTrip] = useState(null);
  const [tab, setTab] = useState('itinerary');
  const refresh = () => request(`/trips/${id}`).then(setTrip);
  useEffect(() => { refresh(); }, [id]);
  if (!trip) return <Loader />;
  const tabs = [['itinerary', CalendarDays], ['budget', CircleDollarSign], ['packing', ClipboardList], ['notes', NotebookPen], ['share', Share2]];
  return <motion.div {...page} className="trip-workspace">
    <section className="trip-cover" style={{ backgroundImage: `linear-gradient(90deg, rgba(30,46,43,.86), rgba(30,46,43,.34)), url(${trip.cover_photo || 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1400&q=80'})` }}>
      <div><span className="eyebrow">{trip.start_date} to {trip.end_date}</span><h1>{trip.name}</h1><p>{trip.description}</p></div>
    </section>
    <div className="tabbar">{tabs.map(([key, Icon]) => <button className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}><Icon size={18} />{key}</button>)}</div>
    {tab === 'itinerary' && <Itinerary trip={trip} refresh={refresh} />}
    {tab === 'budget' && <Budget trip={trip} refresh={refresh} />}
    {tab === 'packing' && <Packing trip={trip} />}
    {tab === 'notes' && <Notes trip={trip} />}
    {tab === 'share' && <Share trip={trip} refresh={refresh} />}
  </motion.div>;
}

function Itinerary({ trip, refresh }) {
  const [view, setView] = useState('list');
  const [stop, setStop] = useState({ city: 'Lisbon', country: 'Portugal', region: 'Europe', start_date: trip.start_date, end_date: trip.start_date });
  const [activity, setActivity] = useState({ title: 'Neighborhood dinner', scheduled_date: trip.start_date, scheduled_time: '19:30', cost: 55, duration_hours: 2 });
  async function addStop(e) {
    e.preventDefault();
    await request(`/trips/${trip.id}/stops`, { method: 'POST', body: JSON.stringify({ ...stop, position: trip.stops.length }) });
    refresh();
  }
  async function addActivity(e, stopId) {
    e.preventDefault();
    await request(`/trips/${trip.id}/activities`, { method: 'POST', body: JSON.stringify({ ...activity, stop_id: stopId }) });
    refresh();
  }
  return <section className="panel"><Header title="Itinerary Builder" action={<Segment value={view} setValue={setView} options={['list', 'calendar']} />} />
    <form className="compact-form" onSubmit={addStop}><input placeholder="City" value={stop.city} onChange={(e) => setStop({ ...stop, city: e.target.value })} /><input placeholder="Country" value={stop.country} onChange={(e) => setStop({ ...stop, country: e.target.value })} /><input type="date" value={stop.start_date} onChange={(e) => setStop({ ...stop, start_date: e.target.value })} /><input type="date" value={stop.end_date} onChange={(e) => setStop({ ...stop, end_date: e.target.value })} /><button className="primary"><MapPin size={17} />Add stop</button></form>
    <div className={view === 'calendar' ? 'calendar-view' : 'timeline'}>{trip.stops.map((s, index) => <article className="stop" key={s.id}><div className="stop-head"><span>{index + 1}</span><div><h3>{s.city}, {s.country}</h3><p>{s.start_date} to {s.end_date}</p></div></div>{trip.activities.filter((a) => a.stop_id === s.id).map((a) => <div className="activity-block" key={a.id}><strong>{a.scheduled_time} · {a.title}</strong><span>${a.cost} · {a.duration_hours}h</span></div>)}<form className="compact-form mini" onSubmit={(e) => addActivity(e, s.id)}><input value={activity.title} onChange={(e) => setActivity({ ...activity, title: e.target.value })} /><input type="date" value={activity.scheduled_date} onChange={(e) => setActivity({ ...activity, scheduled_date: e.target.value })} /><input type="time" value={activity.scheduled_time} onChange={(e) => setActivity({ ...activity, scheduled_time: e.target.value })} /><button>Add activity</button></form></article>)}</div>
    {!trip.stops.length && <Empty text="Add city stops to turn this trip into a timeline." />}
  </section>;
}

function CitySearch() {
  const [cities, setCities] = useState([]);
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('all');
  useEffect(() => { request(`/cities?q=${encodeURIComponent(q)}&region=${region}`).then(setCities); }, [q, region]);
  return <motion.section {...page} className="panel"><Header title="City Search" subtitle="Find cities by region, popularity, and relative cost." /><div className="filters"><input placeholder="Search city or country" value={q} onChange={(e) => setQ(e.target.value)} /><select value={region} onChange={(e) => setRegion(e.target.value)}>{['all', 'Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'].map((r) => <option key={r}>{r}</option>)}</select></div><div className="destination-grid">{cities.map((city) => <Destination key={city.city} city={city} />)}</div></motion.section>;
}

function ActivitySearch() {
  const [items, setItems] = useState([]);
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');
  useEffect(() => { request(`/activities?type=${type}&q=${encodeURIComponent(q)}`).then(setItems); }, [type, q]);
  return <motion.section {...page} className="panel"><Header title="Activity Search" subtitle="Browse activity ideas before attaching them to a stop." /><div className="filters"><input placeholder="Search activities" value={q} onChange={(e) => setQ(e.target.value)} /><select value={type} onChange={(e) => setType(e.target.value)}>{['all', 'culture', 'food', 'outdoors', 'wellness', 'nightlife'].map((r) => <option key={r}>{r}</option>)}</select></div><div className="cards">{items.map((a) => <article className="card" key={a.id}><img src={a.image_url} alt="" /><h3>{a.name}</h3><p>{a.description}</p><span>{a.city} · {a.type} · ${a.cost} · {a.duration_hours}h</span><button className="soft"><Plus size={17} />Add to stop</button></article>)}</div></motion.section>;
}

function Budget({ trip, refresh }) {
  const [budget, setBudget] = useState(trip.budget);
  const breakdown = ['transport', 'stay', 'activities', 'meals'].map((key) => ({ name: key, value: Number(budget[key] || 0) }));
  const spent = breakdown.reduce((sum, item) => sum + item.value, 0);
  const days = Math.max(1, differenceInCalendarDays(parseISO(trip.end_date), parseISO(trip.start_date)) + 1);
  async function save() {
    await request(`/trips/${trip.id}/budget`, { method: 'PUT', body: JSON.stringify(budget) });
    refresh();
  }
  return <section className="panel"><Header title="Trip Budget" action={<button className="primary inline" onClick={save}>Save</button>} />{spent > budget.total_budget && <div className="alert danger">This trip is ${Math.round(spent - budget.total_budget)} over budget.</div>}<div className="budget-grid"><div className="chart"><ResponsiveContainer><PieChart><Pie data={breakdown} dataKey="value" nameKey="name" innerRadius={60}>{breakdown.map((_, i) => <Cell key={i} fill={palette[i]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div><div className="chart"><ResponsiveContainer><BarChart data={breakdown}><CartesianGrid vertical={false} /><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="value" fill="#0d5c63" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer></div></div><div className="stat-grid"><Stat label="Total spent" value={`$${spent}`} /><Stat label="Budget" value={`$${budget.total_budget}`} /><Stat label="Average per day" value={`$${Math.round(spent / days)}`} /></div><div className="budget-inputs">{['total_budget', 'transport', 'stay', 'activities', 'meals'].map((key) => <Field key={key} label={key.replace('_', ' ')} type="number" value={budget[key]} onChange={(value) => setBudget({ ...budget, [key]: Number(value) })} />)}</div></section>;
}

function Packing({ trip }) {
  const [items, setItems] = useState([]);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('clothing');
  const load = () => request(`/trips/${trip.id}/checklist`).then(setItems);
  useEffect(load, [trip.id]);
  async function add(e) {
    e.preventDefault();
    const optimistic = { id: Date.now(), label, category, packed: false };
    setItems([...items, optimistic]);
    setLabel('');
    const saved = await request(`/trips/${trip.id}/checklist`, { method: 'POST', body: JSON.stringify({ label, category }) });
    setItems((current) => current.map((item) => item.id === optimistic.id ? saved : item));
  }
  async function toggle(item) {
    setItems(items.map((x) => x.id === item.id ? { ...x, packed: !x.packed } : x));
    await request(`/checklist/${item.id}`, { method: 'PUT', body: JSON.stringify({ packed: !item.packed }) });
  }
  async function reset() {
    await Promise.all(items.map((item) => request(`/checklist/${item.id}`, { method: 'PUT', body: JSON.stringify({ packed: false }) })));
    load();
  }
  return <section className="panel"><Header title="Packing Checklist" action={<button onClick={reset}>Reset</button>} /><form className="compact-form" onSubmit={add}><input placeholder="Add item" value={label} onChange={(e) => setLabel(e.target.value)} /><select value={category} onChange={(e) => setCategory(e.target.value)}>{['clothing', 'documents', 'electronics', 'misc'].map((c) => <option key={c}>{c}</option>)}</select><button className="primary">Add</button></form><div className="checklist">{items.map((item) => <button className={item.packed ? 'packed' : ''} key={item.id} onClick={() => toggle(item)}>{item.packed ? <CheckCircle2 /> : <span className="circle" />}<span>{item.label}</span><small>{item.category}</small></button>)}</div></section>;
}

function Notes({ trip }) {
  const [notes, setNotes] = useState([]);
  const [body, setBody] = useState('');
  const load = () => request(`/trips/${trip.id}/notes`).then(setNotes);
  useEffect(load, [trip.id]);
  async function add(e) {
    e.preventDefault();
    await request(`/trips/${trip.id}/notes`, { method: 'POST', body: JSON.stringify({ body }) });
    setBody('');
    load();
  }
  return <section className="panel"><Header title="Trip Notes & Journal" /><form className="note-form" onSubmit={add}><textarea placeholder="Capture a booking detail, memory, or idea..." value={body} onChange={(e) => setBody(e.target.value)} /><button className="primary">Add note</button></form><div className="notes">{notes.map((note) => <article key={note.id}><time>{format(parseISO(note.created_at), 'MMM d, yyyy h:mm a')}</time><p>{note.body}</p><button onClick={async () => { await request(`/notes/${note.id}`, { method: 'DELETE' }); load(); }}>Delete</button></article>)}</div></section>;
}

function Share({ trip, refresh }) {
  const url = `${location.origin}/share/${trip.share_slug}`;
  return <section className="panel"><Header title="Shared Itinerary" subtitle="Publish a read-only page with a copyable URL." /><label className="toggle"><input type="checkbox" checked={trip.is_public} onChange={async (e) => { await request(`/trips/${trip.id}`, { method: 'PUT', body: JSON.stringify({ is_public: e.target.checked }) }); refresh(); }} />Public itinerary enabled</label><div className="share-box"><input readOnly value={url} /><button onClick={() => navigator.clipboard.writeText(url)}><Copy size={17} />Copy</button><a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(url)}`}>X</a><a href={`mailto:?subject=Traveloop itinerary&body=${encodeURIComponent(url)}`}>Email</a></div></section>;
}

function PublicTrip() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [trip, setTrip] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { request(`/public/${slug}`).then(setTrip).catch((err) => setError(err.message)); }, [slug]);
  async function copyTrip() {
    if (!user) return location.assign('/login');
    await request(`/trips/${slug}/copy`, { method: 'POST' });
  }
  if (error) return <div className="public-page"><Empty text={error} /></div>;
  if (!trip) return <Loader />;
  return <div className="public-page"><section className="trip-cover public" style={{ backgroundImage: `linear-gradient(90deg, rgba(30,46,43,.86), rgba(30,46,43,.30)), url(${trip.cover_photo})` }}><div><span className="eyebrow">Shared with Traveloop</span><h1>{trip.name}</h1><p>{trip.description}</p><button className="primary inline" onClick={copyTrip}><Copy size={18} />Copy Trip</button></div></section><section className="panel">{trip.stops.map((s) => <article className="stop" key={s.id}><h3>{s.city}, {s.country}</h3>{trip.activities.filter((a) => a.stop_id === s.id).map((a) => <div className="activity-block" key={a.id}>{a.scheduled_time} · {a.title}<span>${a.cost}</span></div>)}</article>)}</section></div>;
}

function SettingsPage() {
  const { user, setUser, logout } = useAuth();
  const [form, setForm] = useState(user);
  async function save(e) {
    e.preventDefault();
    const next = await request('/me', { method: 'PUT', body: JSON.stringify(form) });
    next.saved_destinations = Array.isArray(next.saved_destinations) ? next.saved_destinations : JSON.parse(next.saved_destinations || '[]');
    setUser(next);
    localStorage.setItem('traveloop_user', JSON.stringify(next));
  }
  async function remove() {
    await request('/me', { method: 'DELETE' });
    logout();
  }
  return <motion.section {...page} className="panel form-panel"><Header title="User Profile Pages" subtitle="Image, editable user details, saved destinations, and preplanned trips." /><div className="profile-layout"><div className="profile-photo">{form.photo_url ? <img src={form.photo_url} alt="" /> : <UserRound size={54} />}</div><div className="preplanned"><h3>Preplanned Trips</h3><p>Paris & Rome Adventure</p><p>Kyoto Temple Week</p><p>Lisbon Food Loop</p></div></div><form className="form-grid" onSubmit={save}><Field label="Name" value={form.name || ''} onChange={(name) => setForm({ ...form, name })} /><Field label="Email" type="email" value={form.email || ''} onChange={(email) => setForm({ ...form, email })} /><Field label="Photo URL" value={form.photo_url || ''} onChange={(photo_url) => setForm({ ...form, photo_url })} /><label className="field"><span>Language</span><select value={form.language || 'en'} onChange={(e) => setForm({ ...form, language: e.target.value })}><option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option><option value="hi">Hindi</option></select></label><button className="primary">Save settings</button><button type="button" className="danger-btn" onClick={remove}>Delete account</button></form></motion.section>;
}

function Community() {
  const [query, setQuery] = useState('');
  const [posts, setPosts] = useState([]);
  const [form, setForm] = useState({ destination: '', caption: '', hashtags: '', image_url: '' });
  const [toast, setToast] = useState('');
  const load = () => request(`/community/posts?q=${encodeURIComponent(query)}`).then(setPosts);
  useEffect(() => { load(); }, [query]);
  async function createPost(e) {
    e.preventDefault();
    try {
      const post = await request('/community/posts', { method: 'POST', body: JSON.stringify(form) });
      setPosts([post, ...posts]);
      setForm({ destination: '', caption: '', hashtags: '', image_url: '' });
      setToast('Travel memory posted.');
    } catch (err) { setToast(err.message); }
  }
  async function like(post) {
    const current = posts;
    setPosts(posts.map((item) => item.id === post.id ? { ...item, likes: item.likes + 1 } : item));
    try { await request(`/community/posts/${post.id}/like`, { method: 'POST' }); } catch { setPosts(current); }
  }
  return <motion.section {...page} className="panel community-page"><Header title="Travel Community Feed" subtitle="Upload memories, browse destination photos, and discover trending places." />{toast && <div className="alert">{toast}</div>}<form className="community-compose" onSubmit={createPost}><input placeholder="Destination" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} /><input placeholder="Image URL" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} /><textarea placeholder="Caption" value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} /><input placeholder="#hashtags" value={form.hashtags} onChange={(e) => setForm({ ...form, hashtags: e.target.value })} /><button className="primary">Upload travel memory</button></form><div className="filters"><input placeholder="Search community..." value={query} onChange={(e) => setQuery(e.target.value)} /><select defaultValue="recent"><option value="recent">Sort by recent</option><option value="likes">Sort by likes</option></select></div><div className="masonry-feed">{posts.map((post) => <article className="memory-card" key={post.id}><img loading="lazy" src={post.image_url} alt={post.destination} /><div><span>{post.destination}</span><p>{post.caption}</p><small>{post.hashtags} · {post.author}</small><div className="memory-actions"><button onClick={() => like(post)}>Like {post.likes}</button><button onClick={() => navigator.clipboard.writeText(`${location.origin}/community#post-${post.id}`)}>Share</button><button>Comments {post.comment_count}</button></div></div></article>)}</div></motion.section>;
}

function Invoices() {
  const [trips, setTrips] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [tripId, setTripId] = useState('');
  const [expense, setExpense] = useState({ category: 'hotel', description: '', amount: 0, expense_date: format(new Date(), 'yyyy-MM-dd'), split_with: [] });
  const [toast, setToast] = useState('');
  useEffect(() => { request('/trips').then((rows) => { setTrips(rows); setTripId(rows[0]?.id ? String(rows[0].id) : ''); }); request('/invoices').then(setInvoices); }, []);
  useEffect(() => { if (tripId) request(`/trips/${tripId}/expenses`).then(setExpenses); }, [tripId]);
  async function addExpense(e) {
    e.preventDefault();
    try {
      const saved = await request(`/trips/${tripId}/expenses`, { method: 'POST', body: JSON.stringify({ ...expense, amount: Number(expense.amount) }) });
      setExpenses([saved, ...expenses]);
      setExpense({ ...expense, description: '', amount: 0 });
      setToast('Expense saved.');
    } catch (err) { setToast(err.message); }
  }
  async function generateInvoice() {
    const invoice = await request(`/trips/${tripId}/invoices`, { method: 'POST', body: JSON.stringify({ discount: 0 }) });
    setInvoices([invoice, ...invoices.filter((item) => item.id !== invoice.id)]);
    request('/invoices').then(setInvoices);
  }
  const subtotal = expenses.reduce((sum, row) => sum + Number(row.amount), 0);
  const chartData = Object.values(expenses.reduce((acc, row) => ({ ...acc, [row.category]: { name: row.category, value: (acc[row.category]?.value || 0) + Number(row.amount) } }), {}));
  return <motion.section {...page} className="invoice-page"><div className="panel"><Header title="Expense / Invoice / Billing System" subtitle="Track real trip expenses, split costs, and generate backend PDFs." action={<NavLink to="/trips">back to My Trips</NavLink>} />{toast && <div className="alert">{toast}</div>}<div className="filters"><select value={tripId} onChange={(e) => setTripId(e.target.value)}>{trips.map((trip) => <option value={trip.id} key={trip.id}>{trip.name}</option>)}</select><button className="primary inline" onClick={generateInvoice} disabled={!tripId}>Generate invoice</button></div><form className="expense-form" onSubmit={addExpense}><select value={expense.category} onChange={(e) => setExpense({ ...expense, category: e.target.value })}>{['hotel', 'transport', 'food', 'activities', 'shopping', 'other'].map((item) => <option key={item}>{item}</option>)}</select><input placeholder="Description" value={expense.description} onChange={(e) => setExpense({ ...expense, description: e.target.value })} /><input type="number" placeholder="Amount" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} /><input type="date" value={expense.expense_date} onChange={(e) => setExpense({ ...expense, expense_date: e.target.value })} /><button className="primary">Add expense</button></form><div className="invoice-table"><div className="invoice-row invoice-head"><span>#</span><span>Category</span><span>Description</span><span>Date</span><span>Split</span><span>Amount</span></div>{expenses.map((row, index) => <div className="invoice-row" key={row.id}><span>{index + 1}</span><span>{row.category}</span><span>{row.description}</span><span>{row.expense_date}</span><span>{JSON.parse(row.split_with || '[]').join(', ') || '-'}</span><span>${Number(row.amount).toFixed(2)}</span></div>)}</div><div className="invoice-total"><span>Subtotal</span><strong>$ {subtotal.toFixed(2)}</strong><span>tax(5%)</span><strong>$ {(subtotal * .05).toFixed(2)}</strong><span>Grand Total</span><strong>$ {(subtotal * 1.05).toFixed(2)}</strong></div><div className="actions invoice-actions">{invoices.map((invoice) => <a key={invoice.id} className="primary inline" href={`${API}/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer">Download {invoice.invoice_number || invoice.id} PDF</a>)}</div></div><div className="panel"><Header title="Budget Insights" /><div className="budget-grid invoice-insight"><div className="chart"><ResponsiveContainer><PieChart><Pie data={chartData} dataKey="value" nameKey="name" innerRadius={54}>{chartData.map((_, index) => <Cell key={index} fill={palette[index % palette.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div><div className="insight-copy"><p>Total spent: ${subtotal.toFixed(2)}</p><p>Taxes: ${(subtotal * .05).toFixed(2)}</p><p>Invoice-ready total: ${(subtotal * 1.05).toFixed(2)}</p><NavLink className="primary inline" to="/trips">View Full Budget</NavLink></div></div></div></motion.section>;
}

function Admin() {
  const [data, setData] = useState(null);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState('');
  const load = async () => {
    try {
      const [analytics, staffRows] = await Promise.all([request('/admin/analytics'), request('/admin/staff')]);
      setData(analytics);
      setStaff(staffRows);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };
  useEffect(() => { load(); }, []);
  async function updateStaff(member, patch) {
    const next = { ...member, ...patch };
    setStaff(staff.map((item) => item.id === member.id ? next : item));
    try {
      await request(`/admin/staff/${member.id}`, { method: 'PUT', body: JSON.stringify(next) });
    } catch (err) {
      setError(err.message);
      load();
    }
  }
  if (error) return <motion.section {...page} className="panel"><Header title="Admin Panel" /><div className="alert danger">{error}</div><p className="muted-line">Sign in as `admin@traveloop.test` to manage staff privileges.</p></motion.section>;
  if (!data) return <Loader />;
  return <motion.section {...page} className="panel admin-panel"><Header title="Admin Panel" subtitle="Manage staff privileges, users, trips, invoices, community moderation, destinations, settings, reports, and audit logs." /><div className="stat-grid"><Stat label="Total users" value={data.users} /><Stat label="Active trips" value={data.activeTrips} /><Stat label="Revenue" value={`$${Number(data.revenue || 0).toFixed(0)}`} /><Stat label="Invoices" value={data.invoices} /></div><div className="admin-layout"><div><Header title="Manage Users" subtitle="Block/unblock users, grant roles, and inspect privileges." /><div className="staff-table"><div className="staff-row staff-head"><span>User</span><span>Role</span><span>Status</span><span>Privileges</span><span>Trips</span></div>{staff.map((member) => <div className="staff-row" key={member.id}><span><strong>{member.name}</strong><small>{member.email}</small><label className="block-toggle"><input type="checkbox" checked={member.blocked} onChange={(e) => updateStaff(member, { blocked: e.target.checked })} />Blocked</label></span><select value={member.role || 'traveler'} onChange={(e) => updateStaff(member, { role: e.target.value })}><option value="admin">admin</option><option value="staff">staff</option><option value="traveler">traveler</option></select><select value={member.staff_status || 'active'} onChange={(e) => updateStaff(member, { staff_status: e.target.value })}><option value="active">active</option><option value="suspended">suspended</option></select><textarea value={member.privilege_notes || ''} onChange={(e) => updateStaff(member, { privilege_notes: e.target.value })} /><span>{member.trip_count}</span></div>)}</div></div><div><Header title="Popular cities" /><div className="chart tall"><ResponsiveContainer><BarChart data={data.topCities}><XAxis dataKey="city" /><YAxis /><Tooltip /><Bar dataKey="count" fill="#d69332" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer></div><Header title="Audit logs" /><div className="audit-list">{data.auditLogs.map((log) => <article key={log.id}><strong>{log.action}</strong><span>{log.actor_name || 'System'} · {log.entity_type} #{log.entity_id}</span><small>{log.created_at}</small></article>)}</div></div></div></motion.section>;
}

function Header({ title, subtitle, action }) {
  return <div className="section-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

function Segment({ value, setValue, options }) {
  return <div className="segment">{options.map((opt) => <button className={value === opt ? 'active' : ''} onClick={() => setValue(opt)} key={opt}>{opt}</button>)}</div>;
}

function Stat({ label, value }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong></div>;
}

function Empty({ text }) {
  return <div className="empty"><Compass size={32} /><p>{text}</p></div>;
}

function Loader() {
  return <div className="loader">Loading Traveloop...</div>;
}

function App() {
  return <AuthProvider><BrowserRouter><Routes><Route path="/login" element={<Login />} /><Route path="/share/:slug" element={<PublicTrip />} /><Route path="/*" element={<Protected><Shell><Routes><Route index element={<Dashboard />} /><Route path="create" element={<CreateTrip />} /><Route path="trips" element={<MyTrips />} /><Route path="trips/:id" element={<TripWorkspace />} /><Route path="cities" element={<CitySearch />} /><Route path="activities" element={<ActivitySearch />} /><Route path="community" element={<Community />} /><Route path="invoices" element={<Invoices />} /><Route path="settings" element={<SettingsPage />} /><Route path="admin" element={<AdminProtected><Admin /></AdminProtected>} /></Routes></Shell></Protected>} /></Routes></BrowserRouter></AuthProvider>;
}

createRoot(document.getElementById('root')).render(<App />);
