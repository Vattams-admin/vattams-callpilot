import { useEffect, useState } from 'react'
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { auth } from './firebase'
import './App.css'
import {
  findBusinesses,
  getBusinessDetails,
  resolveLocation,
  MapplsApiError,
  type BusinessPlace,
} from './lib/mappls'

type Category = 'Appointment' | 'Restaurant' | 'Service' | 'Delivery' | 'Business'
type CallStatus = 'idle' | 'calling' | 'connected' | 'conversation' | 'completed'
type Page = 'home' | 'calls' | 'usage' | 'profile'

function searchErrorMessage(error: unknown): string {
  if (error instanceof MapplsApiError) {
    if (error.kind === 'rate_limited') {
      return 'Business search is receiving too many requests right now. Please try again shortly.'
    }
    if (error.kind === 'unauthorized' || error.kind === 'forbidden') {
      return 'Business search is temporarily unavailable. Please try again later.'
    }
    if (error.kind === 'network') {
      return 'We could not reach business search. Please check your connection and try again.'
    }
  }

  return 'Business search is temporarily unavailable. Please try again.'
}

function contactErrorMessage(error: unknown): string {
  if (error instanceof MapplsApiError) {
    if (error.kind === 'rate_limited') {
      return 'Contact lookup is receiving too many requests right now. Please try again shortly.'
    }
    if (error.kind === 'unauthorized' || error.kind === 'forbidden') {
      return 'We could not verify this business contact right now. Please try again later.'
    }
  }

  return 'We could not verify this business contact yet. Please choose another suggestion.'
}

const categories: { name: Category; icon: string }[] = [
  { name: 'Appointment', icon: '📅' },
  { name: 'Restaurant', icon: '🍽️' },
  { name: 'Service', icon: '🔧' },
  { name: 'Delivery', icon: '📦' },
  { name: 'Business', icon: '🏢' },
]

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setAuthLoading(false)
    })
    return unsubscribe
  }, [])

  const [page, setPageState] = useState<Page>(() => {
    const saved = localStorage.getItem('cob_page')
    return saved === 'calls' || saved === 'usage' || saved === 'profile'
      ? saved
      : 'home'
  })

  const setPage = (nextPage: Page) => {
    setPageState(nextPage)
    localStorage.setItem('cob_page', nextPage)
  }

  const handleAuth = async () => {
    setAuthError('')

    if (!authEmail.trim() || !authPassword) {
      setAuthError('Enter your email and password.')
      return
    }

    try {
      if (authMode === 'signup') {
        await createUserWithEmailAndPassword(auth, authEmail.trim(), authPassword)
      } else {
        await signInWithEmailAndPassword(auth, authEmail.trim(), authPassword)
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code.includes('auth/invalid-credential')) {
        setAuthError('Invalid email or password.')
      } else if (code.includes('auth/email-already-in-use')) {
        setAuthError('This email is already registered.')
      } else if (code.includes('auth/weak-password')) {
        setAuthError('Password must be at least 6 characters.')
      } else if (code.includes('auth/invalid-email')) {
        setAuthError('Enter a valid email address.')
      } else {
        setAuthError('Authentication failed. Please try again.')
      }
    }
  }

  const handleLogout = async () => {
    await signOut(auth)
  }
  const [category, setCategory] = useState<Category>('Appointment')
  const [recipient, setRecipient] = useState('')
  const [request, setRequest] = useState('')
  const [taskDetails, setTaskDetails] = useState<Record<string, string>>({})
  const [showPlan, setShowPlan] = useState(false)
  const [businessSuggestions, setBusinessSuggestions] = useState<BusinessPlace[]>([])
  const [selectedBusiness, setSelectedBusiness] = useState<BusinessPlace | null>(null)
  const [noPhoneBusiness, setNoPhoneBusiness] = useState<BusinessPlace | null>(null)
  const [discoveryLoading, setDiscoveryLoading] = useState(false)
  const [callStatus, setCallStatus] = useState<CallStatus>('idle')
  const [completedCalls, setCompletedCalls] = useState(0)

  const [callHistory, setCallHistory] = useState<Array<{
    recipient: string
    category: Category
    request: string
  }>>([])

  useEffect(() => {
    if (!user) {
      setCompletedCalls(0)
      setCallHistory([])
      return
    }

    const callsKey = `cob_completed_calls_${user.uid}`
    const historyKey = `cob_call_history_${user.uid}`

    try {
      const savedCount = Number(localStorage.getItem(callsKey) ?? '0')
      setCompletedCalls(Number.isFinite(savedCount) && savedCount >= 0 ? savedCount : 0)

      const savedHistory = localStorage.getItem(historyKey)
      const parsedHistory = savedHistory ? JSON.parse(savedHistory) : []
      setCallHistory(Array.isArray(parsedHistory) ? parsedHistory : [])
    } catch {
      setCompletedCalls(0)
      setCallHistory([])
    }
  }, [user])

  useEffect(() => {
    if (callStatus === 'calling') {
      const timer = setTimeout(() => setCallStatus('connected'), 1800)
      return () => clearTimeout(timer)
    }

    if (callStatus === 'connected') {
      const timer = setTimeout(() => setCallStatus('conversation'), 1800)
      return () => clearTimeout(timer)
    }

    if (callStatus === 'conversation') {
      const timer = setTimeout(() => setCallStatus('completed'), 2200)
      return () => clearTimeout(timer)
    }

    if (callStatus === 'completed' && user) {
      const callsKey = `cob_completed_calls_${user.uid}`
      const historyKey = `cob_call_history_${user.uid}`

      setCompletedCalls((count) => {
        const next = count + 1
        localStorage.setItem(callsKey, String(next))
        return next
      })

      setCallHistory((history) => {
        const next = [
          ...history,
          { recipient, category, request },
        ]
        localStorage.setItem(historyKey, JSON.stringify(next))
        return next
      })
    }
  }, [callStatus, user, recipient, category, request])

  const createPlan = async () => {
    if (!recipient.trim() || !request.trim()) return

    if (completedCalls >= 3) {
      alert('Your 3 free demo tasks are complete.')
      return
    }

    setDiscoveryLoading(true)
    setBusinessSuggestions([])
    setSelectedBusiness(null)
    setNoPhoneBusiness(null)

    try {
      const serviceNeeded = taskDetails.service?.trim()
      const areaLocation = taskDetails.location?.trim()

      const searchParts =
        category === 'Service'
          ? [serviceNeeded || recipient.trim(), request.trim(), areaLocation]
          : [recipient.trim(), request.trim(), areaLocation]

      const searchQuery = searchParts
        .filter(Boolean)
        .join(' ')

      const location = areaLocation
        ? await resolveLocation(areaLocation)
        : null

      if (areaLocation && !location) {
        alert(`We could not understand the location "${areaLocation}". Please check the area/city and try again.`)
        return
      }

      const businesses = await findBusinesses(searchQuery, location ?? undefined)

      if (!businesses.length) {
        alert(
          areaLocation
            ? `We could not find a matching business near ${areaLocation}. Please check the business or location and try again.`
            : 'We could not find a matching business. Please add an area/location and try again.',
        )
        return
      }

      setBusinessSuggestions(businesses)
    } catch (error) {
      console.error('Business discovery failed:', error)
      alert(searchErrorMessage(error))
    } finally {
      setDiscoveryLoading(false)
    }
  }

  const selectBusiness = async (place: BusinessPlace) => {
    setDiscoveryLoading(true)

    try {
      const details = await getBusinessDetails(place)

      if (!details.phone && !details.phoneOther?.length) {
        setNoPhoneBusiness(place)
        return
      }


      setSelectedBusiness({ ...place, ...details })
      setRecipient(place.name)
      setBusinessSuggestions([])
      setShowPlan(true)
    } catch (error) {
      console.error('Business details lookup failed:', error)
      alert(contactErrorMessage(error))
    } finally {
      setDiscoveryLoading(false)
    }
  }

  const approveCall = () => {
    setShowPlan(false)
    setCallStatus('calling')
  }

  const renderHome = () => (
    <>
      <section className="hero">
        <div className="eyebrow">YOUR PERSONAL CALLING ASSISTANT</div>
        <h1>You ask.<br /><span>We call.</span></h1>
        <p>
          Tell us what you need. We'll prepare the call,
          get your approval, and bring the result back to you.
        </p>
      </section>

      <section className="task-card">
        <div className="card-title">
          <div>
            <span className="step">01</span>
            <h2>What do you need?</h2>
          </div>
          <span className="free-count">3 FREE TASKS</span>
        </div>

        <div className="categories">
          {categories.map((item) => (
            <button
              key={item.name}
              className={category === item.name ? 'category active' : 'category'}
              onClick={() => setCategory(item.name)}
              type="button"
            >
              <span>{item.icon}</span>
              {item.name}
            </button>
          ))}
        </div>

        <label>
          BUSINESS / RECIPIENT
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="e.g. ABC Clinic"
          />
        </label>

        {discoveryLoading && (
          <div className="discovery-status">
            🔎 Finding the business and checking public contact details…
          </div>
        )}

        {businessSuggestions.length > 0 && (
          <div className="business-suggestions">
            <div className="suggestions-title">Which business do you mean?</div>

            {businessSuggestions.map((place) => (
              <button
                key={place.placeId}
                className="business-suggestion"
                onClick={() => selectBusiness(place)}
                type="button"
              >
                <strong>{place.name}</strong>
                <span>{place.address}</span>
              </button>
            ))}
          </div>
        )}

        {noPhoneBusiness && (
          <div className="business-suggestions">
            <div className="suggestions-title">We found the business, but no verified public phone number.</div>

            <div className="business-suggestion">
              <strong>{noPhoneBusiness.name}</strong>
              <span>{noPhoneBusiness.address}</span>
            </div>

            <button
              className="cancel-btn"
              onClick={() => setNoPhoneBusiness(null)}
              type="button"
            >
              Try another suggestion
            </button>
          </div>
        )}

        <div className="smart-details">
          <div className="smart-details-title">
            <span>02</span>
            <div>
              <strong>Task details</strong>
              <small>Tell us only what is relevant to this task.</small>
            </div>
          </div>

          {category === 'Appointment' && (
            <div className="detail-grid">
              <label>
                PREFERRED DATE
                <input
                  type="date"
                  value={taskDetails.date ?? ''}
                  onChange={(e) => setTaskDetails({ ...taskDetails, date: e.target.value })}
                />
              </label>
              <label>
                PREFERRED TIME
                <input
                  type="time"
                  value={taskDetails.time ?? ''}
                  onChange={(e) => setTaskDetails({ ...taskDetails, time: e.target.value })}
                />
              </label>
              <label>
                PERSON / DEPARTMENT
                <input
                  value={taskDetails.preference ?? ''}
                  onChange={(e) => setTaskDetails({ ...taskDetails, preference: e.target.value })}
                  placeholder="Optional"
                />
              </label>
              <label>
                FLEXIBLE TIMING?
                <select
                  value={taskDetails.flexible ?? 'Yes'}
                  onChange={(e) => setTaskDetails({ ...taskDetails, flexible: e.target.value })}
                >
                  <option>Yes</option>
                  <option>No</option>
                </select>
              </label>
            </div>
          )}

          {category === 'Restaurant' && (
            <div className="detail-grid">
              <label>
                DATE
                <input
                  type="date"
                  value={taskDetails.date ?? ''}
                  onChange={(e) => setTaskDetails({ ...taskDetails, date: e.target.value })}
                />
              </label>
              <label>
                TIME
                <input
                  type="time"
                  value={taskDetails.time ?? ''}
                  onChange={(e) => setTaskDetails({ ...taskDetails, time: e.target.value })}
                />
              </label>
              <label>
                NUMBER OF GUESTS
                <input
                  type="number"
                  min="1"
                  value={taskDetails.guests ?? ''}
                  onChange={(e) => setTaskDetails({ ...taskDetails, guests: e.target.value })}
                  placeholder="e.g. 4"
                />
              </label>
              <label>
                SEATING PREFERENCE
                <input
                  value={taskDetails.seating ?? ''}
                  onChange={(e) => setTaskDetails({ ...taskDetails, seating: e.target.value })}
                  placeholder="Optional"
                />
              </label>
            </div>
          )}

          {category === 'Service' && (
            <div className="detail-grid">
              <label>
                SERVICE NEEDED
                <input
                  value={taskDetails.service ?? ''}
                  onChange={(e) => setTaskDetails({ ...taskDetails, service: e.target.value })}
                  placeholder="e.g. AC service"
                />
              </label>
              <label>
                PREFERRED DATE
                <input
                  type="date"
                  value={taskDetails.date ?? ''}
                  onChange={(e) => setTaskDetails({ ...taskDetails, date: e.target.value })}
                />
              </label>
              <label>
                PREFERRED TIME
                <input
                  type="time"
                  value={taskDetails.time ?? ''}
                  onChange={(e) => setTaskDetails({ ...taskDetails, time: e.target.value })}
                />
              </label>
              <label>
                AREA / LOCATION
                <input
                  value={taskDetails.location ?? ''}
                  onChange={(e) => setTaskDetails({ ...taskDetails, location: e.target.value })}
                  placeholder="e.g. Coimbatore"
                />
              </label>
            </div>
          )}

          {category === 'Delivery' && (
            <div className="detail-grid">
              <label>
                ORDER / REFERENCE NUMBER
                <input
                  value={taskDetails.reference ?? ''}
                  onChange={(e) => setTaskDetails({ ...taskDetails, reference: e.target.value })}
                  placeholder="Optional"
                />
              </label>
              <label>
                DELIVERY ISSUE
                <input
                  value={taskDetails.issue ?? ''}
                  onChange={(e) => setTaskDetails({ ...taskDetails, issue: e.target.value })}
                  placeholder="e.g. Delivery delayed"
                />
              </label>
            </div>
          )}

          {category === 'Business' && (
            <div className="detail-grid">
              <label>
                PURPOSE
                <input
                  value={taskDetails.purpose ?? ''}
                  onChange={(e) => setTaskDetails({ ...taskDetails, purpose: e.target.value })}
                  placeholder="What do you need from them?"
                />
              </label>
              <label>
                PREFERRED TIME
                <input
                  type="time"
                  value={taskDetails.time ?? ''}
                  onChange={(e) => setTaskDetails({ ...taskDetails, time: e.target.value })}
                />
              </label>
            </div>
          )}

          <label>
            WHAT SHOULD WE ASK?
            <textarea
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="Describe what you want CallPilot to find out or get done."
              rows={4}
            />
          </label>
        </div>

        <button className="primary-btn" onClick={createPlan} type="button">
          Create Call Plan <span>→</span>
        </button>

        <div className="trust-note">
          <span>✓</span> No call is made without your approval.
        </div>
      </section>

      <section className="how-section">
        <div className="section-label">HOW IT WORKS</div>
        <div className="steps">
          <div><b>01</b><strong>Tell us</strong><p>Describe what you need.</p></div>
          <div><b>02</b><strong>Review</strong><p>See exactly what AI will ask.</p></div>
          <div><b>03</b><strong>Approve</strong><p>You control every call.</p></div>
          <div><b>04</b><strong>Get result</strong><p>Receive the answer.</p></div>
        </div>
      </section>
    </>
  )

  const renderCalls = () => (
    <section className="page-panel">
      <div className="section-label">CALL HISTORY</div>
      <h1>Your Calls</h1>
      <p>Your completed and recent call tasks will appear here.</p>

      <div className="history-card">
        {callHistory.length > 0 ? (
          [...callHistory].reverse().map((call, index) => (
            <div className="history-row" key={`${call.recipient}-${index}`}>
              <div>
                <strong>{call.recipient}</strong>
                <span>{call.category} · {call.request}</span>
              </div>
              <b className="status-done">COMPLETED</b>
            </div>
          ))
        ) : (
          <div className="history-row">
            <div>
              <strong>No calls yet</strong>
              <span>Your approved calls will appear here.</span>
            </div>
          </div>
        )}
      </div>
    </section>
  )

  const renderUsage = () => (
    <section className="page-panel">
      <div className="section-label">YOUR USAGE</div>
      <h1>Usage</h1>
      <p>Demo plan usage. Completed tasks count toward your free allowance.</p>

      <div className="usage-card">
        <div className="usage-number">
          {Math.min(completedCalls, 3)} <span>/ 3 tasks</span>
        </div>

        <div className="usage-bar">
          <div
            style={{
              width: `${Math.min((completedCalls / 3) * 100, 100)}%`,
            }}
          />
        </div>

        <p>
          {Math.max(3 - completedCalls, 0)} free demo task
          {Math.max(3 - completedCalls, 0) === 1 ? '' : 's'} remaining.
        </p>
      </div>
    </section>
  )

  const renderProfile = () => (
    <section className="page-panel">
      <div className="section-label">ACCOUNT</div>
      <h1>Profile</h1>
      <p>Your VATTAMS CallPilot account.</p>

      <div className="profile-card">
        <div className="profile-avatar">
          {(user?.email?.slice(0, 2) || 'VP').toUpperCase()}
        </div>
        <strong>{user?.email || 'CallPilot User'}</strong>
        <span>Firebase account</span>
        <button className="secondary-button" onClick={handleLogout}>
          Sign Out
        </button>
      </div>
    </section>
  )

  const renderAuth = () => (
    <div className="app-shell auth-shell">
      <div className="auth-card">
        <div className="brand auth-brand">
          <div className="brand-mark">☎</div>
          <div>
            <strong>VATTAMS CallPilot</strong>
            <span>AI CALLING ASSISTANT</span>
          </div>
        </div>

        <div className="section-label">WELCOME</div>
        <h1>{authMode === 'login' ? 'Sign in to CallPilot' : 'Create your CallPilot account'}</h1>
        <p>
          {authMode === 'login'
            ? 'Sign in to continue with your calls.'
            : 'Create an account to start using CallPilot.'}
        </p>

        <div className="auth-form">
          <label>Email</label>
          <input
            type="email"
            value={authEmail}
            onChange={(e) => setAuthEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />

          <label>Password</label>
          <input
            type="password"
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            placeholder="Minimum 6 characters"
            autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
          />

          {authError && <div className="auth-error">{authError}</div>}

          <button className="primary-button auth-button" onClick={handleAuth}>
            {authMode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </div>

        <button
          className="text-button"
          onClick={() => {
            setAuthMode(authMode === 'login' ? 'signup' : 'login')
            setAuthError('')
          }}
        >
          {authMode === 'login'
            ? 'New to CallPilot? Create an account'
            : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )

  if (authLoading) {
    return (
      <div className="app-shell auth-shell">
        <div className="auth-card auth-loading">
          <div className="call-orb">☎</div>
          <strong>VATTAMS CallPilot</strong>
          <span>Checking your account…</span>
        </div>
      </div>
    )
  }

  if (!user) {
    return renderAuth()
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">☎</div>
          <div>
            <strong>VATTAMS CallPilot</strong>
            <span>AI CALLING ASSISTANT</span>
          </div>
        </div>
        <div className="demo-badge">DEMO</div>
      </header>

      <main>
        {page === 'home' && renderHome()}
        {page === 'calls' && renderCalls()}
        {page === 'usage' && renderUsage()}
        {page === 'profile' && renderProfile()}
      </main>

      {callStatus !== 'idle' && (
        <div className="call-progress-backdrop">
          <div className="call-progress">
            <div className="call-orb">
              {callStatus === 'completed' ? '✓' : '☎'}
            </div>

            {callStatus === 'calling' && (
              <>
                <span className="progress-label">CALLING</span>
                <h2>Connecting to {recipient}</h2>
                <p>Starting your approved call…</p>
              </>
            )}

            {callStatus === 'connected' && (
              <>
                <span className="progress-label">CONNECTED</span>
                <h2>Call connected</h2>
                <p>The AI assistant is introducing itself on your behalf.</p>
              </>
            )}

            {callStatus === 'conversation' && (
              <>
                <span className="progress-label">IN CONVERSATION</span>
                <h2>Getting your answer</h2>
                <p>Asking only the questions you approved.</p>
              </>
            )}

            {callStatus === 'completed' && (
              <>
                <span className="progress-label completed-label">COMPLETED</span>
                <h2>Call completed</h2>
                <p>Your requested information has been collected.</p>

                <div className="demo-result">
                  <div>
                    <span>RECIPIENT</span>
                    <strong>{recipient}</strong>
                  </div>
                  <div>
                    <span>REQUEST</span>
                    <strong>{request}</strong>
                  </div>
                  <div>
                    <span>STATUS</span>
                    <strong>Demo simulation completed</strong>
                  </div>
                </div>

                <button
                  className="primary-btn"
                  onClick={() => setCallStatus('idle')}
                  type="button"
                >
                  Back to Home <span>→</span>
                </button>
              </>
            )}

            {callStatus !== 'completed' && (
              <div className="progress-dots">
                <i></i>
                <i></i>
                <i></i>
              </div>
            )}
          </div>
        </div>
      )}

      <nav className="bottom-nav">
        <button
          className={page === 'home' ? 'nav-active' : ''}
          onClick={() => setPage('home')}
          type="button"
        >
          <span>⌂</span>Home
        </button>

        <button
          className={page === 'calls' ? 'nav-active' : ''}
          onClick={() => setPage('calls')}
          type="button"
        >
          <span>◷</span>Calls
        </button>

        <button
          className={page === 'usage' ? 'nav-active' : ''}
          onClick={() => setPage('usage')}
          type="button"
        >
          <span>◉</span>Usage
        </button>

        <button
          className={page === 'profile' ? 'nav-active' : ''}
          onClick={() => setPage('profile')}
          type="button"
        >
          <span>○</span>Profile
        </button>
      </nav>

      {showPlan && (
        <div className="modal-backdrop" onClick={() => setShowPlan(false)}>
          <div className="plan-modal" onClick={(e) => e.stopPropagation()}>
            <div className="plan-head">
              <span>CALL PLAN</span>
              <button
                aria-label="Close call plan"
                onClick={() => setShowPlan(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <div className="approval-status">AWAITING YOUR APPROVAL</div>

            <h2>{recipient}</h2>
            <p className="plan-purpose">{request}</p>

            {Object.entries(taskDetails).some(([, value]) => value.trim()) && (
              <div className="plan-task-details">
                <div className="plan-detail-title">TASK DETAILS</div>

                {Object.entries(taskDetails)
                  .filter(([, value]) => value.trim())
                  .map(([key, value]) => (
                    <div className="plan-detail" key={key}>
                      <span>{key.replace(/([A-Z])/g, ' $1').toUpperCase()}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
              </div>
            )}

            {selectedBusiness && (
              <div className="plan-detail">
                <span>VERIFIED CONTACT</span>
                <strong>{selectedBusiness.phone ?? selectedBusiness.phoneOther?.[0]}</strong>
              </div>
            )}

            {selectedBusiness?.address && (
              <div className="plan-detail">
                <span>LOCATION</span>
                <strong>{selectedBusiness.address}</strong>
              </div>
            )}

            <div className="plan-detail">
              <span>CALL TYPE</span>
              <strong>{category}</strong>
            </div>

            <div className="ai-notice">
              <span>✦</span>
              <p>
                The AI will identify itself as an AI assistant calling
                on your behalf and will only ask about the request above.
              </p>
            </div>

            <button className="approve-btn" onClick={approveCall} type="button">
              Approve Call <span>→</span>
            </button>

            <button
              className="cancel-btn"
              onClick={() => setShowPlan(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
