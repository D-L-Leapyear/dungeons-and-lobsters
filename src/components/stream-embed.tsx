import React from 'react';

export function StreamEmbed({
  src,
  title,
}: {
  src: string;
  title: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black">
      {/* 16:9 */}
      <div className="relative pt-[56.25%]">
        {/*
          We crop ~5% off each side by scaling up a bit.
          scale(1.12) ≈ 6% crop per side.
        */}
        <iframe
          title={title}
          src={src}
          loading="lazy"
          className="absolute left-0 top-0 h-full w-full origin-center scale-[1.12]"
          style={{ border: 'none' }}
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
          allowFullScreen
        />
      </div>
    </div>
  );
}
