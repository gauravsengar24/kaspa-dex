import { Github, Twitter, MessageCircle } from "lucide-react"

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-kaspa-border/30 py-6">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-gradient-to-br from-kaspa-pink to-kaspa-purple flex items-center justify-center text-[8px] font-bold text-white">K</span>
            <span className="text-sm font-display font-bold text-gradient">KASPA Swap</span>
          </div>

          <p className="text-xs text-kaspa-muted">
            Built on Kaspa — Native L1 DEX | Testnet-12
          </p>

          <div className="flex items-center gap-3">
            {[
              { icon: Github, href: "#", label: "GitHub" },
              { icon: Twitter, href: "#", label: "Twitter" },
              { icon: MessageCircle, href: "#", label: "Discord" },
            ].map(({ icon: Icon, href, label }) => (
              <a
                key={label}
                href={href}
                aria-label={label}
                className="w-8 h-8 rounded-lg glass flex items-center justify-center text-kaspa-muted hover:text-white hover:border-kaspa-pink/50 transition-all"
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
