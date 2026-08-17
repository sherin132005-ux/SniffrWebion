export default function LoadingPage() {
  return (
    <div className="bg-background text-on-surface min-h-screen flex items-center justify-center overflow-hidden selection:bg-primary-container selection:text-on-primary-container">
      {/* THE PLUSH CANVAS BACKGROUND */}
      <div className="fixed inset-0 bg-gradient-to-br from-primary to-primary-fixed-dim opacity-10"></div>
      
      {/* SIGNATURE WATERMARK TEXTURES */}
      <span className="material-symbols-outlined absolute text-[25rem] -top-24 -left-32 rotate-12 text-primary opacity-[0.05] pointer-events-none z-0" style={{ fontVariationSettings: "'FILL' 1" }}>pets</span>
      <span className="material-symbols-outlined absolute text-[18rem] -bottom-12 -right-16 -rotate-12 text-primary opacity-[0.05] pointer-events-none z-0" style={{ fontVariationSettings: "'FILL' 1" }}>pets</span>
      <span className="material-symbols-outlined absolute text-[12rem] top-1/2 -right-20 rotate-45 text-primary opacity-[0.05] pointer-events-none z-0" style={{ fontVariationSettings: "'FILL' 1" }}>pets</span>

      {/* LOADING CANVAS */}
      <main className="relative z-10 w-full max-w-md px-8 flex flex-col items-center justify-center space-y-10">
        {/* CENTRAL ICON VESSEL */}
        <div className="relative mt-12">
          {/* Glow Effect */}
          <div className="absolute inset-0 bg-primary-fixed-dim blur-[60px] opacity-20 rounded-full scale-150"></div>
          {/* Soft Rounded Container */}
          <div className="relative w-48 h-48 bg-surface-container-lowest shadow-[0_10px_30px_-15px_rgba(0,0,0,0.05)] rounded-[3.5rem] flex items-center justify-center">
            <div className="relative flex flex-col items-center">
              {/* Paw Spinner Icon */}
              <span className="material-symbols-outlined text-primary text-7xl animate-pulse" style={{ fontVariationSettings: "'FILL' 1" }}>pets</span>
            </div>
          </div>
        </div>

        {/* EDITORIAL TEXT STACK */}
        <div className="text-center space-y-6">
          <h1 className="text-4xl font-headline font-extrabold tracking-tight text-primary leading-tight px-4">
            Finding the <br/>
            <span className="text-tertiary">Perfect Friend</span>
          </h1>

          {/* DYNAMIC STATUS LIST */}
          <div className="flex flex-col items-center space-y-3">
            {/* Active Loading State */}
            <div className="bg-primary-container text-on-primary-container px-6 py-2 rounded-full flex items-center space-x-3 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.06)]">
              <span className="material-symbols-outlined text-sm animate-spin">search</span>
              <span className="font-label text-[10px] font-bold uppercase tracking-[0.1em]">Sniffing out matches...</span>
            </div>
            {/* Upcoming States */}
            <div className="flex flex-col space-y-2 opacity-30">
              <div className="flex items-center space-x-2">
                <span className="material-symbols-outlined text-xs">favorite</span>
                <span className="font-label text-[10px] font-bold uppercase tracking-[0.05em]">Wagging tails...</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="material-symbols-outlined text-xs">auto_awesome</span>
                <span className="font-label text-[10px] font-bold uppercase tracking-[0.05em]">Purr-fecting your feed...</span>
              </div>
            </div>
          </div>
        </div>

        {/* PLUSH CONTENT CARD */}
        <div className="w-full bg-surface-container-low p-6 rounded-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-tertiary-container/20 rounded-full -translate-y-16 translate-x-16"></div>
          <div className="relative z-10 flex items-center space-x-4">
            <div className="w-16 h-16 overflow-hidden bg-white shadow-sm flex-shrink-0 rounded-full">
              <img 
                alt="Doodle puppy" 
                className="w-full h-full object-cover" 
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuDb4yNRRzzCoc0OugKOl5o971uH8ABKVCKqIrqrOHilzBm3X_OoC8eggSazMipsW5W3ffGzkvQrhPNc3q4cXGP3_CzQNahui8p8CtPanYnPniU6h1STijpI2a_ohnVCqaqNqPpPqAI4mSn9FCnBkS7PCPVTyD6a0Q9T9RpXmC7ZuLxc3bugnqk7e5n71nSB95JyPTJsJCdHDFCvLnNrob5iNjL1m1ZhN8WqeWHBoPPCPorqfnktG84NEURkAJjvYeAm_VW6AjlPIc0"
              />
            </div>
            <div className="flex-1 text-left">
              <p className="text-[10px] font-bold text-tertiary uppercase tracking-wider mb-1">Daily Tip</p>
              <p className="text-sm text-on-surface-variant leading-tight">Bring your pet's favorite squeaky toy to the first meet-up!</p>
            </div>
          </div>
        </div>

        {/* PROGRESS BAR */}
        <div className="w-full max-w-[240px] h-2 bg-surface-container-high rounded-full overflow-hidden">
          <div className="h-full w-2/3 bg-gradient-to-r from-primary to-primary-fixed-dim rounded-full animate-[loading_2s_ease-in-out_infinite]"></div>
        </div>

        <div className="flex flex-col items-center opacity-40">
          <span className="text-2xl font-extrabold tracking-tighter text-primary">Sniffr</span>
          <span className="text-[8px] uppercase tracking-[0.3em] mt-1 text-on-surface-variant font-bold">Safety First, Sniffing Second</span>
        </div>
      </main>
    </div>
  );
}
