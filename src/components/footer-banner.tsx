import Image from 'next/image';

const FOOTER_URL = 'https://imagedelivery.net/FOMtIMVchithxFD0fhbh3g/2003ad1e-0720-418c-528b-ba7ff81f4200/public';

export function FooterBanner() {
  return (
    <footer className="mt-12">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        <Image
          src={FOOTER_URL}
          alt="Dungeon footer"
          width={1600}
          height={500}
          className="h-auto w-full object-cover"
        />

        <div className="pointer-events-none absolute right-4 top-4 sm:right-6 sm:top-6">
          <div className="rounded-xl bg-neutral-950/45 px-4 py-3 backdrop-blur-sm">
            <div className="font-serif text-lg italic text-amber-200 drop-shadow-sm sm:text-2xl">
              Happy questing, lobster friend
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
