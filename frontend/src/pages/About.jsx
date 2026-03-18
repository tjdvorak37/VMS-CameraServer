import { useEffect, useMemo, useState } from 'react'
import { Search, BookOpen, Download, Copy } from 'lucide-react'
import { dashboardApi } from '../services/api'

const SYSTEMD_SERVICE = `[Unit]
Description=VMS Camera Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/VMS-CameraServer
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm --prefix /opt/VMS-CameraServer/backend run start
Restart=always
RestartSec=5
User=vms
Group=vms

[Install]
WantedBy=multi-user.target`

const NGINX_SITE = `server {
    listen 80;
    server_name vms.local;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}`

const ABOUT_SECTIONS = [
  {
    id: 'platform-overview',
    category: 'Platform',
    title: 'System Overview',
    summary:
      'VMS Pro is a self-hosted video management platform with camera discovery, live streaming, recording, event workflows, and role-based access.',
    tags: ['on-prem', 'self-hosted', 'video management', 'react', 'express'],
    details: [
      'The frontend is a React + Vite app that talks to an Express API. The API handles authentication, camera orchestration, events, and users.',
      'Video streaming and recording are powered by FFmpeg workers managed per camera. Metadata is kept in SQLite for fast local deployment.',
      'This architecture is designed for local networks first, with remote access supported through VPN or reverse proxy.',
    ],
    keyPoints: [
      'Single-page web UI for operators and admins',
      'Token-based API security with role gates',
      'Real-time WebSocket notifications for important events',
    ],
  },
  {
    id: 'camera-discovery',
    category: 'Cameras',
    title: 'Camera Discovery and Vendor Profiling',
    summary:
      'ONVIF discovery now enriches each device with profile labels and style/type hints so your team can focus on Avigilon-style cameras first.',
    tags: ['onvif', 'discovery', 'avigilon', 'profile filter'],
    details: [
      'Discovery parses ONVIF scopes and metadata, then infers manufacturer, camera style (for example PTZ, dome, bullet), and device type.',
      'Results are ranked by confidence, with Avigilon and Avigilon-like vendors surfaced first for faster camera onboarding.',
      'The Discover modal supports profile filtering, style filtering, and text search to isolate the right devices quickly.',
    ],
    keyPoints: [
      'Best for mixed-vendor deployments with a dominant preferred brand',
      'Reduces manual camera review time',
      'Improves consistency of initial RTSP setup defaults',
    ],
  },
  {
    id: 'streaming-recording',
    category: 'Video Pipeline',
    title: 'Live Streaming and Recording Pipeline',
    summary:
      'Each camera can run independent streaming and recording workers so you can control operational cost and fault isolation.',
    tags: ['hls', 'ffmpeg', 'recording', 'retention'],
    details: [
      'Live view is delivered using HLS segments and manifests generated per camera. Player retries and status overlays provide operator visibility.',
      'Continuous recording writes segmented MP4 files and indexes metadata for fast playback and retention operations.',
      'Retention jobs remove old footage and event records according to system settings while preserving recent operational data.',
    ],
    keyPoints: [
      'Independent stream/record toggles per camera',
      'Segmented recordings for efficient browsing and deletion',
      'Retention policy controlled from System Settings',
    ],
  },
  {
    id: 'security-operations',
    category: 'Operations',
    title: 'Security, Roles, and Operations',
    summary:
      'Security defaults include JWT auth, role restrictions, and API rate limits, with operations features for monitoring and maintenance.',
    tags: ['security', 'roles', 'audit', 'operations'],
    details: [
      'Admin, Operator, and Viewer roles control access to management actions. UI and API both enforce role checks.',
      'Rate limiting on auth and API routes helps protect against abuse and brute force attempts.',
      'Dashboard telemetry, events, and camera status indicators provide baseline observability for day-to-day operations.',
    ],
    keyPoints: [
      'Complete first-run setup wizard and secure admin account credentials',
      'Use reverse proxy TLS in production',
      'Back up database and recording metadata regularly',
    ],
  },
  {
    id: 'deployment-guide',
    category: 'Deployment',
    title: 'Step-by-Step Local Server Deployment Guide',
    summary:
      'Production-oriented deployment flow for local servers running Ubuntu or Debian with systemd and nginx.',
    tags: ['deployment', 'local server', 'systemd', 'nginx', 'production'],
    details: [
      'This sequence gives you a repeatable on-prem install with service auto-restart and reverse proxy access.',
      'Commands below assume a server path of /opt/VMS-CameraServer and host name vms.local. Adjust for your environment.',
    ],
    steps: [
      {
        title: 'Prepare the server host',
        description:
          'Assign a static IP, create DNS entry or hosts file mapping, and ensure outbound internet is available for package installs.',
        commands: [
          'hostnamectl set-hostname vms-server',
          'timedatectl set-timezone America/Chicago',
        ],
      },
      {
        title: 'Install runtime dependencies',
        description:
          'Install Node.js, FFmpeg, and nginx. FFmpeg is required for both live streaming and recording.',
        commands: [
          'sudo apt update',
          'sudo apt install -y curl git ffmpeg nginx',
          'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -',
          'sudo apt install -y nodejs',
          'node -v && npm -v && ffmpeg -version | head -1',
        ],
      },
      {
        title: 'Clone and initialize the project',
        description:
          'Place the project under /opt and run setup to install dependencies and generate a secure .env file.',
        commands: [
          'sudo mkdir -p /opt && cd /opt',
          'sudo git clone <your-repo-url> VMS-CameraServer',
          'cd /opt/VMS-CameraServer',
          'sudo chmod +x setup.sh',
          'sudo ./setup.sh',
        ],
      },
      {
        title: 'Configure environment for production',
        description:
          'Set trusted origins, JWT secret, retention policy, and any custom storage paths.',
        commands: [
          'cd /opt/VMS-CameraServer',
          'sudo test -f .env || sudo cp .env.example .env',
          'sudo nano .env',
          '# If setup.sh already created .env, edit it in place and keep generated JWT_SECRET',
          '# Set PORT=3001, NODE_ENV=production, CORS_ORIGINS=http://vms.local',
        ],
      },
      {
        title: 'Build frontend assets',
        description:
          'Build the frontend so backend production mode can serve static assets directly.',
        commands: [
          'cd /opt/VMS-CameraServer',
          'npm --prefix frontend run build',
        ],
      },
      {
        title: 'Create a dedicated service account and systemd service',
        description:
          'Run backend as a non-root service and configure auto-start on boot.',
        commands: [
          'sudo useradd --system --shell /usr/sbin/nologin --home /opt/VMS-CameraServer vms || true',
          'sudo chown -R vms:vms /opt/VMS-CameraServer',
          'sudo nano /etc/systemd/system/vms.service',
          '# Paste the unit shown below, then enable and start the service',
          'sudo systemctl daemon-reload',
          'sudo systemctl enable --now vms',
          'sudo systemctl status vms --no-pager',
        ],
        codeBlock: SYSTEMD_SERVICE,
      },
      {
        title: 'Configure nginx reverse proxy',
        description:
          'Expose the app on standard HTTP/HTTPS ports and forward traffic to backend port 3001.',
        commands: [
          'sudo nano /etc/nginx/sites-available/vms',
          '# Paste the nginx server block shown below',
          'sudo ln -sf /etc/nginx/sites-available/vms /etc/nginx/sites-enabled/vms',
          'sudo nginx -t',
          'sudo systemctl reload nginx',
        ],
        codeBlock: NGINX_SITE,
      },
      {
        title: 'Open firewall and verify health',
        description:
          'Allow HTTP/HTTPS and verify API health before user onboarding.',
        commands: [
          'sudo ufw allow 80/tcp',
          'sudo ufw allow 443/tcp',
          'curl -I http://127.0.0.1:3001/api/health',
          'curl -I http://vms.local/api/health',
        ],
      },
      {
        title: 'First login and hardening checklist',
        description:
          'Complete the web setup wizard, sign in with your configured admin account, then finish hardening.',
        commands: [
          'Open http://vms.local/setup in a browser',
          'Create your first admin account and finish setup',
          'Sign in at http://vms.local/login with your configured credentials',
          'Enable HTTPS certificate (Lets Encrypt or internal PKI)',
        ],
      },
    ],
    keyPoints: [
      'Use HTTPS in production and disable plain HTTP if possible',
      'Back up backend/data/vms.db and recording metadata',
      'Monitor disk usage and retention impact weekly',
    ],
  },
]

function sectionSearchText(section) {
  const stepsText = (section.steps || [])
    .flatMap(step => [step.title, step.description, ...(step.commands || []), step.codeBlock || ''])
    .join(' ')

  return [
    section.title,
    section.summary,
    section.category,
    ...(section.tags || []),
    ...(section.details || []),
    ...(section.keyPoints || []),
    stepsText,
  ]
    .join(' ')
    .toLowerCase()
}

function buildDesktopConfig(serverUrl) {
  return {
    app: 'VMS Desktop Client',
    version: 1,
    serverUrl,
    generatedAt: new Date().toISOString(),
  }
}

export default function About() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [exportStatus, setExportStatus] = useState({ type: '', message: '' })
  const [configuredPublicUrl, setConfiguredPublicUrl] = useState('')

  useEffect(() => {
    let isMounted = true

    dashboardApi.settings()
      .then(res => {
        if (!isMounted) return
        const configured = String(res.data?.public_base_url || '').trim()
        if (configured) setConfiguredPublicUrl(configured.replace(/\/$/, ''))
      })
      .catch(() => {
        // Keep browser-origin fallback when settings are unavailable.
      })

    return () => {
      isMounted = false
    }
  }, [])

  const detectedServerUrl = useMemo(() => {
    if (configuredPublicUrl) return configuredPublicUrl
    if (typeof window === 'undefined') return ''
    return window.location.origin.replace(/\/$/, '')
  }, [configuredPublicUrl])

  const categories = useMemo(() => {
    const values = Array.from(new Set(ABOUT_SECTIONS.map(section => section.category)))
    return ['all', ...values]
  }, [])

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase()

    return ABOUT_SECTIONS.filter(section => {
      const categoryMatch = category === 'all' || section.category === category
      if (!categoryMatch) return false
      if (!q) return true
      return sectionSearchText(section).includes(q)
    })
  }, [query, category])

  const copyServerUrl = async () => {
    if (!detectedServerUrl) {
      setExportStatus({ type: 'error', message: 'Unable to detect server URL in this browser.' })
      return
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(detectedServerUrl)
      } else {
        const temp = document.createElement('textarea')
        temp.value = detectedServerUrl
        document.body.appendChild(temp)
        temp.select()
        document.execCommand('copy')
        temp.remove()
      }
      setExportStatus({ type: 'ok', message: 'Server URL copied to clipboard.' })
    } catch {
      setExportStatus({ type: 'error', message: 'Copy failed. Please copy the URL manually.' })
    }
  }

  const exportDesktopConfig = () => {
    if (!detectedServerUrl) {
      setExportStatus({ type: 'error', message: 'Unable to detect server URL in this browser.' })
      return
    }

    const payload = buildDesktopConfig(detectedServerUrl)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const objectUrl = URL.createObjectURL(blob)
    const date = new Date().toISOString().slice(0, 10)

    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `vms-desktop-config-${date}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(objectUrl)

    setExportStatus({ type: 'ok', message: 'Desktop config file exported.' })
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <BookOpen size={18} className="text-accent" />
              <h2 className="text-xl font-semibold text-slate-100">About VMS Pro and Deployment Guide</h2>
            </div>
            <p className="text-sm text-slate-400 mt-2 max-w-3xl">
              Search this section to quickly find architecture details, operational guidance, and a full local server deployment runbook.
            </p>
          </div>
          <div className="text-xs text-slate-400 bg-surface-800 border border-surface-500 rounded-lg px-3 py-2">
            {filteredSections.length} of {ABOUT_SECTIONS.length} sections visible
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          <div className="md:col-span-2 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="input pl-9"
              placeholder="Search features, deployment steps, commands, vendors, or troubleshooting notes"
            />
          </div>
          <div>
            <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
              {categories.map(item => (
                <option key={item} value={item}>
                  {item === 'all' ? 'All categories' : item}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Desktop Client Quick Launch</h3>
            <p className="text-sm text-slate-400 mt-1">
              One click export for desktop users. Send this config file to users, then import it in the desktop app.
            </p>
          </div>
          <span className="badge bg-surface-500 text-slate-300">One-click onboarding</span>
        </div>

        <div className="mt-3 p-3 rounded-lg border border-surface-500 bg-surface-800">
          <p className="text-xs text-slate-500">
            {configuredPublicUrl ? 'Configured Public Base URL' : 'Detected server URL'}
          </p>
          <p className="font-mono text-sm text-slate-200 mt-1 break-all">{detectedServerUrl || 'Unavailable'}</p>
          {configuredPublicUrl && (
            <p className="text-xs text-success mt-1">Using URL configured in Settings &gt; Server Setup.</p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={exportDesktopConfig} className="btn-primary">
            <Download size={14} className="inline mr-1.5" />Export Desktop Config
          </button>
          <button onClick={copyServerUrl} className="btn-secondary">
            <Copy size={14} className="inline mr-1.5" />Copy Server URL
          </button>
        </div>

        {exportStatus.message && (
          <p className={`text-xs mt-3 ${exportStatus.type === 'error' ? 'text-danger' : 'text-success'}`}>
            {exportStatus.message}
          </p>
        )}
      </div>

      {filteredSections.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-slate-300">No matches for your search.</p>
          <p className="text-xs text-slate-500 mt-1">Try a wider term like "deployment", "recording", or "camera".</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredSections.map(section => (
            <article key={section.id} className="card space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-100">{section.title}</h3>
                  <p className="text-sm text-slate-400 mt-1">{section.summary}</p>
                </div>
                <span className="badge bg-accent/20 text-accent">{section.category}</span>
              </div>

              {!!section.tags?.length && (
                <div className="flex flex-wrap gap-1.5">
                  {section.tags.map(tag => (
                    <span key={tag} className="badge bg-surface-500 text-slate-300">#{tag}</span>
                  ))}
                </div>
              )}

              {!!section.details?.length && (
                <div className="space-y-2">
                  {section.details.map((detail, idx) => (
                    <p key={`${section.id}-detail-${idx}`} className="text-sm text-slate-300 leading-relaxed">{detail}</p>
                  ))}
                </div>
              )}

              {!!section.keyPoints?.length && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-200 mb-2">Key points</h4>
                  <ul className="space-y-1 text-sm text-slate-300 list-disc pl-5">
                    {section.keyPoints.map(point => (
                      <li key={`${section.id}-${point}`}>{point}</li>
                    ))}
                  </ul>
                </div>
              )}

              {!!section.steps?.length && (
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold text-slate-200">Deployment steps</h4>
                  {section.steps.map((step, idx) => (
                    <div key={`${section.id}-step-${idx}`} className="bg-surface-800 border border-surface-500 rounded-lg p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <h5 className="text-sm font-semibold text-slate-200">{step.title}</h5>
                      </div>
                      <p className="text-sm text-slate-400">{step.description}</p>
                      {!!step.commands?.length && (
                        <div className="space-y-1">
                          {step.commands.map((command, commandIdx) => (
                            <pre
                              key={`${section.id}-step-${idx}-cmd-${commandIdx}`}
                              className="text-xs text-slate-200 bg-black/30 border border-surface-600 rounded px-3 py-2 overflow-x-auto"
                            >
{command}
                            </pre>
                          ))}
                        </div>
                      )}
                      {step.codeBlock && (
                        <pre className="text-xs text-slate-200 bg-black/30 border border-surface-600 rounded px-3 py-2 overflow-x-auto">
{step.codeBlock}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
