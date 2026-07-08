import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { User, Award, TrendingUp, Droplets, Star, Zap, Shield, Crown } from "lucide-react"
import { NETWORK } from "../utils/constants"
import { formatKaspa } from "../utils/kaspa"
import type { UserProfile } from "../types"

const rankIcons: Record<string, any> = {
  bronze: Shield,
  silver: Star,
  gold: Crown,
  diamond: Zap,
}

const rankColors: Record<string, string> = {
  bronze: "text-amber-600",
  silver: "text-slate-300",
  gold: "text-kaspa-gold",
  diamond: "text-kaspa-pink",
}

export default function Profile() {
  const [address] = useState("kaspa:testuser1")
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${NETWORK.backend}/api/profile/${address}`)
      .then((r) => r.json())
      .then((d) => { setProfile(d.profile); setLoading(false) })
      .catch(() => setLoading(false))
  }, [address])

  const recordSwap = async () => {
    const res = await fetch(`${NETWORK.backend}/api/profile/record-swap/${address}?volume=100`, { method: "POST" })
    const d = await res.json()
    setProfile(d.profile)
  }

  if (loading) return <div className="glass rounded-2xl p-8 animate-shimmer h-64" />

  if (!profile) return <p className="text-center text-kaspa-muted py-8">Profile not found</p>

  const RankIcon = rankIcons[profile.rank] || Shield

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="glass rounded-2xl p-6 text-center"
      >
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-kaspa-pink to-kaspa-purple flex items-center justify-center mx-auto mb-4">
          <User size={32} className="text-white" />
        </div>
        <p className="font-mono text-sm text-kaspa-muted mb-1">{profile.address.slice(0, 12)}...</p>
        <div className="flex items-center justify-center gap-2 mb-4">
          <RankIcon size={18} className={rankColors[profile.rank]} />
          <span className={`font-display font-bold text-lg capitalize ${rankColors[profile.rank]}`}>
            {profile.rank}
          </span>
        </div>
        <p className="text-xs text-kaspa-muted">Joined {new Date(profile.created_at * 1000).toLocaleDateString()}</p>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Swaps", value: profile.total_swaps.toString(), icon: TrendingUp, color: "from-kaspa-green to-kaspa-green/50" },
          { label: "Total Volume", value: `${formatKaspa(profile.total_volume)} KAS`, icon: Zap, color: "from-kaspa-pink to-kaspa-purple" },
          { label: "Liquidity Added", value: formatKaspa(profile.liquidity_added), icon: Droplets, color: "from-kaspa-purple to-kaspa-pink" },
          { label: "Achievements", value: `${profile.achievements.length}`, icon: Award, color: "from-kaspa-gold to-kaspa-red" },
        ].map((item) => (
          <motion.div key={item.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="glass rounded-2xl p-4 text-center"
          >
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center mx-auto mb-2`}>
              <item.icon size={18} className="text-white" />
            </div>
            <p className="text-lg font-bold">{item.value}</p>
            <p className="text-xs text-kaspa-muted">{item.label}</p>
          </motion.div>
        ))}
      </div>

      {profile.achievements.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Award size={16} className="text-kaspa-gold" />
            <h3 className="font-display font-bold">Achievements</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {profile.achievements.map((a, i) => (
              <span key={i} className="glass rounded-lg px-3 py-1.5 text-xs font-medium flex items-center gap-1">
                <Star size={10} className="text-kaspa-gold" />
                {a}
              </span>
            ))}
          </div>
        </motion.div>
      )}

      <button onClick={recordSwap} className="btn-primary w-full">
        Record Test Swap (+100 KAS volume)
      </button>
    </div>
  )
}
