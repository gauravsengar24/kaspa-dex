import { useState, useEffect, useRef } from "react"
import { motion } from "framer-motion"
import { Bot, Send, Sparkles, ArrowRight, Loader2 } from "lucide-react"
import { NETWORK } from "../utils/constants"
import type { SkillDefinition } from "../types"

interface Message {
  role: "user" | "assistant"
  text: string
  data?: any
}

export default function AIAssistant() {
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Hi! I'm your DeFi AI assistant. I can help you swap tokens, provide liquidity, and manage yield strategies. Try asking me to do something!" },
  ])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`${NETWORK.backend}/api/ai/skills`)
      .then((r) => r.json())
      .then((d) => setSkills(Object.values(d.paths || {})))
      .catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const executeSkill = async (skillName: string, params: Record<string, any>) => {
    setLoading(true)
    setMessages((prev) => [...prev, { role: "user", text: `Execute: ${skillName}`, data: params }])
    try {
      const res = await fetch(`${NETWORK.backend}/api/ai/skills/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill: skillName, params }),
      })
      const data = await res.json()
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: data.result ? `✅ ${data.result}` : data.error ? `❌ ${data.error}` : "Done!",
        data,
      }])
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", text: "Sorry, something went wrong." }])
    }
    setLoading(false)
  }

  const handleSend = () => {
    if (!input.trim()) return
    setMessages((prev) => [...prev, { role: "user", text: input }])
    setInput("")

    const lowered = input.toLowerCase()
    if (lowered.includes("swap") || lowered.includes("exchange")) {
      executeSkill("swap", { token_in: "KAS", token_out: "NACHO", amount: 100 })
    } else if (lowered.includes("liquidity") || lowered.includes("provide")) {
      executeSkill("liquidity", { pool: "kas-nacho", action: "add", amount: 100 })
    } else if (lowered.includes("yield") || lowered.includes("vault")) {
      executeSkill("yield", { vault: "KAS Yield Vault", action: "deposit", amount: 100 })
    } else {
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: "Available commands:\n• \"Swap 100 KAS for NACHO\"\n• \"Add liquidity to KAS-NACHO pool\"\n• \"Deposit into KAS yield vault\"\nOr click a skill below!",
      }])
    }
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-display font-bold">AI Assistant</h1>
        <p className="text-kaspa-muted text-sm mt-1">Natural language DeFi agent</p>
      </div>

      <div className="glass rounded-2xl flex flex-col h-[500px]">
        <div className="flex items-center gap-2 p-4 border-b border-kaspa-border/50">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-kaspa-pink to-kaspa-purple flex items-center justify-center">
            <Bot size={16} className="text-white" />
          </div>
          <span className="font-display font-bold">Kaspa Agent</span>
          <span className="w-1.5 h-1.5 rounded-full bg-kaspa-green animate-pulse" />
          <span className="text-xs text-kaspa-muted">Online</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((msg, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
            >
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-lg bg-kaspa-purple/20 flex items-center justify-center shrink-0">
                  <Bot size={14} className="text-kaspa-purple" />
                </div>
              )}
              <div className={`max-w-[80%] rounded-xl p-3 text-sm ${
                msg.role === "user" ? "bg-kaspa-pink/20 text-white" : "glass"
              }`}>
                <p className="whitespace-pre-wrap">{msg.text}</p>
                {msg.data?.route && (
                  <div className="mt-2 text-xs text-kaspa-muted flex items-center gap-1">
                    Route: {msg.data.route.map((r: any) => r.pool_id).join(" → ")}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="p-4 border-t border-kaspa-border/50">
          <div className="flex items-center gap-2 glass rounded-xl px-4 py-3">
            <input type="text" value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Ask me to swap, provide liquidity, or manage yield..."
              className="flex-1 bg-transparent border-0 outline-none text-sm"
            />
            <button onClick={handleSend} disabled={!input.trim() || loading}
              className="text-kaspa-pink hover:text-white disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>

          {skills.length > 0 && (
            <div className="flex gap-2 mt-2 overflow-x-auto">
              {skills.slice(0, 5).map((s) => (
                <button key={s.name} onClick={() => executeSkill(s.name, {})}
                  className="flex items-center gap-1 shrink-0 text-xs glass rounded-lg px-2.5 py-1.5 hover:bg-white/10 transition-colors"
                >
                  <Sparkles size={10} className="text-kaspa-gold" />
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
