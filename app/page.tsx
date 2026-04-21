import { requestMagicLinkAction } from "@/actions/sessions";
import { ArrowRight } from "lucide-react";

export default function LandingPage() {
  return (
    <main className="min-h-screen w-full flex items-center justify-center p-4 bg-[#06060c]">
      <div className="w-full max-w-[560px] pb-[10vh]">
        <header className="mb-10">
          <div className="font-mono text-[10.5px] tracking-[0.25em] text-[#88888b] uppercase mb-6">
            Formal Document Delivery
          </div>
          <h1 className="text-[2.75rem] leading-none font-semibold text-white tracking-tight mb-4">
            Edict
          </h1>
          <p className="text-base text-[#A1A1A8] font-medium w-[90%]">
            A rector issues edicts. Sign in to read yours.
          </p>
        </header>

        <form action={requestMagicLinkAction} className="flex flex-col gap-4">
          <input
            type="email"
            name="email"
            required
            placeholder="you@company.com"
            spellCheck={false}
            className="w-full bg-[#0b0b12] border border-[#1f1f2e] focus:border-[#00e5ff] text-white px-4 py-3.5 rounded-[3px] outline-none transition-colors duration-300 placeholder:text-[#7a7a8c] font-mono text-sm"
          />
          <button
            type="submit"
            className="group w-full bg-white text-black font-semibold text-sm px-4 py-3.5 rounded-[3px] hover:bg-[#00e5ff] transition-all duration-300 flex items-center justify-center gap-2 h-[52px]"
          >
            Send me my magic link
            <ArrowRight
              size={16}
              strokeWidth={2.5}
              className="opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all duration-300"
            />
          </button>
        </form>

        <p className="text-sm text-[#7a7a8c] mt-6">
          If this email is on file, your link is on its way.
        </p>

        <footer className="mt-20 pt-6 border-t border-[#1f1f2e] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 font-mono text-[11px] text-[#7a7a8c] tracking-wide">
          <span className="uppercase">Edict Platform</span>
          <span>edict.rectorspace.com</span>
        </footer>
      </div>
    </main>
  );
}
