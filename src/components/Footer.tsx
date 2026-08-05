import { Github, Twitter, MessageCircle } from "lucide-react"

export default function Footer() {
  return (
    <footer className="mt-auto px-4 pb-4">
      <div className="max-w-6xl mx-auto glass rounded-2xl py-5 px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-kaspa-blue to-kaspa-purple flex items-center justify-center text-[8px] font-bold text-white">K</span>
            <span className="text-sm font-display font-bold text-gradient">Kaspa Swap</span>
          </div>

          <p className="text-xs text-kaspa-muted">
            Built on Kaspa — Native L1 DEX | Mainnet
          </p>

          <div className="flex items-center gap-3">
            {[
              { icon: Github, href: "https://github.com/gauravsengar24/kaspa-dex", label: "GitHub" },
              { icon: Twitter, href: "https://x.com", label: "Twitter" },
              { icon: MessageCircle, href: "https://discord.com", label: "Discord" },
            ].map(({ icon: Icon, href, label }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={label}
                className="w-8 h-8 rounded-xl dock-icon flex items-center justify-center text-kaspa-muted hover:text-kaspa-cyan transition-all"
              >
                <Icon size={14} />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}