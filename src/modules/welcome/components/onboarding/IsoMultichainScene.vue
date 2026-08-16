<template>
  <!-- The multichain hero scene, on the Nexus home-hero grammar
       (nexus/docs/marketing/ISOMETRIC-ICONS.md + hero-scene-geometry.md):
       four chain nodes (plate, LED row, two brand blocks, lifted tip wearing
       the official chain mark sheared onto its top face) feed chain-tinted
       beams with packet cubes into a three-plate Gero core. Motion is
       loop-law compliant (3.2s master loop, 1.6s divisors, negative staggers
       only) and collapses under prefers-reduced-motion with packets parked
       mid-beam via their inline offset-distance. -->
  <svg viewBox="0 0 640 264" class="iso-multichain" aria-hidden="true">
    <defs>
      <linearGradient id="gwo-plate" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dbe2ea" /><stop offset="1" stop-color="#a8b4c2" /></linearGradient>
      <linearGradient id="gwo-btcBlock" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc46b" /><stop offset="1" stop-color="#F7931A" /></linearGradient>
      <linearGradient id="gwo-btcTip" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd694" /><stop offset="1" stop-color="#ff9f2e" /></linearGradient>
      <linearGradient id="gwo-adaBlock" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6f9cff" /><stop offset="1" stop-color="#2f5fd0" /></linearGradient>
      <linearGradient id="gwo-adaTip" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9dbcff" /><stop offset="1" stop-color="#3f6de0" /></linearGradient>
      <linearGradient id="gwo-apxBlock" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f59a70" /><stop offset="1" stop-color="#E06030" /></linearGradient>
      <linearGradient id="gwo-apxTip" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8b28f" /><stop offset="1" stop-color="#ec7040" /></linearGradient>
      <!-- Midnight runs lighter than the site hero's brand-dark faces: that
           board sits on white, ours on near-black where they vanish. -->
      <linearGradient id="gwo-mdnBlock" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#565e6b" /><stop offset="1" stop-color="#262b35" /></linearGradient>
      <linearGradient id="gwo-mdnTip" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b95a7" /><stop offset="1" stop-color="#2f3440" /></linearGradient>
      <linearGradient id="gwo-coreTop" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#86e9f5" /><stop offset="1" stop-color="#37c6dd" /></linearGradient>
      <linearGradient id="gwo-coreMid" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4fc3dc" /><stop offset="1" stop-color="#1997b4" /></linearGradient>
      <!-- Beam gradients pinned to user space: an objectBoundingBox gradient
           collapses on a near-horizontal path (handoff trap). -->
      <linearGradient id="gwo-beamBtc" gradientUnits="userSpaceOnUse" x1="110" y1="80" x2="508" y2="152"><stop offset="0" stop-color="#F7931A" stop-opacity="0.92" /><stop offset="1" stop-color="#00A8C8" stop-opacity="0.95" /></linearGradient>
      <linearGradient id="gwo-beamAda" gradientUnits="userSpaceOnUse" x1="184" y1="132" x2="508" y2="156"><stop offset="0" stop-color="#2f5fd0" stop-opacity="0.92" /><stop offset="1" stop-color="#00A8C8" stop-opacity="0.95" /></linearGradient>
      <linearGradient id="gwo-beamApx" gradientUnits="userSpaceOnUse" x1="52" y1="134" x2="508" y2="162"><stop offset="0" stop-color="#E06030" stop-opacity="0.92" /><stop offset="1" stop-color="#00A8C8" stop-opacity="0.95" /></linearGradient>
      <linearGradient id="gwo-beamMdn" gradientUnits="userSpaceOnUse" x1="110" y1="192" x2="508" y2="164"><stop offset="0" stop-color="#3b4250" stop-opacity="0.92" /><stop offset="1" stop-color="#00A8C8" stop-opacity="0.95" /></linearGradient>
      <radialGradient id="gwo-bloom"><stop offset="0" stop-color="#00CCBB" stop-opacity="0.14" /><stop offset="1" stop-color="#00CCBB" stop-opacity="0" /></radialGradient>
    </defs>

    <!-- Bloom + ground shadows -->
    <ellipse cx="520" cy="170" rx="120" ry="72" fill="url(#gwo-bloom)" />
    <ellipse cx="100" cy="134" rx="42" ry="7" fill="#0e2a3d" opacity="0.14" />
    <ellipse cx="40" cy="192" rx="42" ry="7" fill="#0e2a3d" opacity="0.14" />
    <ellipse cx="172" cy="192" rx="42" ry="7" fill="#0e2a3d" opacity="0.14" />
    <ellipse cx="100" cy="250" rx="42" ry="7" fill="#0e2a3d" opacity="0.14" />
    <ellipse cx="524" cy="228" rx="66" ry="10" fill="#0e2a3d" opacity="0.16" />

    <!-- Beams: guide under live dash. Painted before the bodies so both ends
         are swallowed (sandwich rule). -->
    <path d="M110,80 C260,95 390,135 508,152" stroke="#F7931A" stroke-width="1.4" fill="none" opacity="0.2" />
    <path d="M110,80 C260,95 390,135 508,152" class="iso-beam" stroke="url(#gwo-beamBtc)" stroke-width="2.6" fill="none" stroke-dasharray="3 9" stroke-linecap="round" />
    <path d="M184,132 C300,140 410,150 508,156" stroke="#2f5fd0" stroke-width="1.4" fill="none" opacity="0.2" />
    <path d="M184,132 C300,140 410,150 508,156" class="iso-beam" stroke="url(#gwo-beamAda)" stroke-width="2.6" fill="none" stroke-dasharray="3 9" stroke-linecap="round" />
    <path d="M52,134 C230,185 390,175 508,162" stroke="#E06030" stroke-width="1.4" fill="none" opacity="0.2" />
    <path d="M52,134 C230,185 390,175 508,162" class="iso-beam" stroke="url(#gwo-beamApx)" stroke-width="2.6" fill="none" stroke-dasharray="3 9" stroke-linecap="round" />
    <path d="M110,192 C280,205 400,175 508,164" stroke="#4b5563" stroke-width="1.4" fill="none" opacity="0.2" />
    <path d="M110,192 C280,205 400,175 508,164" class="iso-beam" stroke="url(#gwo-beamMdn)" stroke-width="2.6" fill="none" stroke-dasharray="3 9" stroke-linecap="round" />

    <g class="iso-pkt" style="offset-path: path('M110,80 C260,95 390,135 508,152'); offset-distance: 25%">
      <polygon points="-5,-2.2 0,-4.6 5,-2.2 0,0.4" fill="#ffc46b" />
      <polygon points="-5,-2.2 0,0.4 0,4.6 -5,2.2" fill="#ef8f14" />
      <polygon points="5,-2.2 0,0.4 0,4.6 5,2.2" fill="#c2700c" />
    </g>
    <g class="iso-pkt" style="offset-path: path('M184,132 C300,140 410,150 508,156'); offset-distance: 45%; animation-delay: -0.8s">
      <polygon points="-5,-2.2 0,-4.6 5,-2.2 0,0.4" fill="#7ba4ff" />
      <polygon points="-5,-2.2 0,0.4 0,4.6 -5,2.2" fill="#2f5fd0" />
      <polygon points="5,-2.2 0,0.4 0,4.6 5,2.2" fill="#24499f" />
    </g>
    <g class="iso-pkt" style="offset-path: path('M52,134 C230,185 390,175 508,162'); offset-distance: 65%; animation-delay: -1.6s">
      <polygon points="-5,-2.2 0,-4.6 5,-2.2 0,0.4" fill="#f5a179" />
      <polygon points="-5,-2.2 0,0.4 0,4.6 -5,2.2" fill="#d05a28" />
      <polygon points="5,-2.2 0,0.4 0,4.6 5,2.2" fill="#a8441f" />
    </g>
    <g class="iso-pkt" style="offset-path: path('M110,192 C280,205 400,175 508,164'); offset-distance: 85%; animation-delay: -2.4s">
      <polygon points="-5,-2.2 0,-4.6 5,-2.2 0,0.4" fill="#9aa3ae" />
      <polygon points="-5,-2.2 0,0.4 0,4.6 -5,2.2" fill="#4b5563" />
      <polygon points="5,-2.2 0,0.4 0,4.6 5,2.2" fill="#374151" />
    </g>

    <!-- Bitcoin node -->
    <g>
      <polygon points="62,100 100,119 100,127 62,108" fill="#7c8a9c" />
      <polygon points="138,100 100,119 100,127 138,108" fill="#5b6878" />
      <polygon points="100,81 138,100 100,119 62,100" fill="url(#gwo-plate)" />
      <circle cx="78" cy="111" r="2.6" fill="#F7931A" />
      <circle cx="90" cy="117" r="2.6" fill="#94a3b8" />
      <circle cx="102" cy="123" r="2.6" fill="#64748b" />
      <polygon points="74,88 100,101 100,112 74,99" fill="#d97a0f" />
      <polygon points="126,88 100,101 100,112 126,99" fill="#b0600b" />
      <polygon points="100,75 126,88 100,101 74,88" fill="url(#gwo-btcBlock)" />
      <polygon points="74,74 100,87 100,98 74,85" fill="#d97a0f" />
      <polygon points="126,74 100,87 100,98 126,85" fill="#b0600b" />
      <polygon points="100,61 126,74 100,87 74,74" fill="url(#gwo-btcBlock)" />
      <path d="M74,74 L100,61 L126,74" stroke="#ffe0b0" stroke-width="1" fill="none" opacity="0.4" />
      <g class="iso-lift">
        <polygon points="74,60 100,73 100,84 74,71" fill="#e0851a" />
        <polygon points="126,60 100,73 100,84 126,71" fill="#bb6a10" />
        <polygon points="100,47 126,60 100,73 74,60" fill="url(#gwo-btcTip)" />
        <path d="M74,60 L100,47 L126,60" stroke="#fff1dc" stroke-width="1.2" fill="none" opacity="0.65" />
        <g transform="translate(100 60) matrix(0.56 0.28 -0.56 0.28 0 0) translate(-16 -16)" opacity="0.97">
          <path d="M6.6,4.6 H17.6 C21.2,4.6 23.6,6.9 23.6,10.3 C23.6,12.6 22.5,14.3 20.8,15.2 C23.2,16 24.9,18 24.9,20.9 C24.9,24.7 21.9,27.4 17.7,27.4 H6.6 Z M11.3,8.6 V13.9 H16.9 C18.6,13.9 19.6,12.9 19.6,11.2 C19.6,9.6 18.6,8.6 16.9,8.6 Z M11.3,18 V23.4 H17.6 C19.5,23.4 20.6,22.3 20.6,20.7 C20.6,19.1 19.5,18 17.6,18 Z" fill="#ffffff" fill-rule="evenodd" />
          <rect x="11.4" y="0.8" width="3.6" height="5.6" fill="#ffffff" />
          <rect x="17.8" y="0.8" width="3.6" height="5.6" fill="#ffffff" />
          <rect x="11.4" y="25.6" width="3.6" height="5.6" fill="#ffffff" />
          <rect x="17.8" y="25.6" width="3.6" height="5.6" fill="#ffffff" />
        </g>
      </g>
    </g>

    <!-- Apex Fusion node -->
    <g>
      <polygon points="2,158 40,177 40,185 2,166" fill="#7c8a9c" />
      <polygon points="78,158 40,177 40,185 78,166" fill="#5b6878" />
      <polygon points="40,139 78,158 40,177 2,158" fill="url(#gwo-plate)" />
      <circle cx="18" cy="169" r="2.6" fill="#E06030" />
      <circle cx="30" cy="175" r="2.6" fill="#94a3b8" />
      <circle cx="42" cy="181" r="2.6" fill="#64748b" />
      <polygon points="14,146 40,159 40,170 14,157" fill="#c04d24" />
      <polygon points="66,146 40,159 40,170 66,157" fill="#9c3c1a" />
      <polygon points="40,133 66,146 40,159 14,146" fill="url(#gwo-apxBlock)" />
      <polygon points="14,132 40,145 40,156 14,143" fill="#c04d24" />
      <polygon points="66,132 40,145 40,156 66,143" fill="#9c3c1a" />
      <polygon points="40,119 66,132 40,145 14,132" fill="url(#gwo-apxBlock)" />
      <path d="M14,132 L40,119 L66,132" stroke="#ffd2ba" stroke-width="1" fill="none" opacity="0.4" />
      <g class="iso-lift" style="animation-delay: -0.4s">
        <polygon points="14,118 40,131 40,142 14,129" fill="#cc5628" />
        <polygon points="66,118 40,131 40,142 66,129" fill="#a8441f" />
        <polygon points="40,105 66,118 40,131 14,118" fill="url(#gwo-apxTip)" />
        <path d="M14,118 L40,105 L66,118" stroke="#ffe6d8" stroke-width="1.2" fill="none" opacity="0.65" />
        <g transform="translate(40 118) matrix(0.56 0.28 -0.56 0.28 0 0) translate(-16 -16)" opacity="0.97">
          <g transform="translate(16 16) scale(0.3164) translate(-50.57 -49.86)"><path d="M46.4589 88.3853L33.7111 75.6374L46.4589 71.3881V88.3853ZM52.1247 13.0312L65.1558 26.0623L52.1247 30.3116V13.0312ZM99.1501 49.5751C98.5836 47.5921 96.6006 46.7422 94.6176 47.3088L54.1077 61.1898V37.6771L74.5043 30.8782L75.9207 30.5949L76.204 30.0283V25.779L75.9207 25.4958L50.9915 0.566572L50.4249 0.283286H45.3258L44.7592 0.283286L44.4759 0.849858V32.5779L2.2663 47.3088C0.283293 47.8754 -0.566566 49.8584 0 51.8414C0.566579 53.8244 2.54958 54.6742 4.53258 54.1076L46.4589 40.2266V63.7394L25.779 70.5382L24.9292 70.8215L24.6459 71.3881V74.7875L24.9292 75.3541L25.4958 75.9207L48.7252 99.1501L49.2918 99.4334L49.8584 99.7167H55.2408L55.8074 99.4334L56.0907 98.8669V67.4221L98.8669 52.6912C100.283 52.1246 101.133 50.9915 101.133 49.5751C99.4334 50.4249 99.1501 50.1416 99.1501 49.5751Z" fill="#ffffff" /></g>
        </g>
      </g>
    </g>

    <!-- Cardano node (forward at the arrowhead tip) -->
    <g>
      <polygon points="134,158 172,177 172,185 134,166" fill="#7c8a9c" />
      <polygon points="210,158 172,177 172,185 210,166" fill="#5b6878" />
      <polygon points="172,139 210,158 172,177 134,158" fill="url(#gwo-plate)" />
      <circle cx="150" cy="169" r="2.6" fill="#00CCBB" />
      <circle cx="162" cy="175" r="2.6" fill="#94a3b8" />
      <circle cx="174" cy="181" r="2.6" fill="#64748b" />
      <polygon points="146,146 172,159 172,170 146,157" fill="#2b53b8" />
      <polygon points="198,146 172,159 172,170 198,157" fill="#1e3c8c" />
      <polygon points="172,133 198,146 172,159 146,146" fill="url(#gwo-adaBlock)" />
      <polygon points="146,132 172,145 172,156 146,143" fill="#2b53b8" />
      <polygon points="198,132 172,145 172,156 198,143" fill="#1e3c8c" />
      <polygon points="172,119 198,132 172,145 146,132" fill="url(#gwo-adaBlock)" />
      <path d="M146,132 L172,119 L198,132" stroke="#b6cdff" stroke-width="1" fill="none" opacity="0.4" />
      <g class="iso-lift" style="animation-delay: -0.8s">
        <polygon points="146,118 172,131 172,142 146,129" fill="#3160cf" />
        <polygon points="198,118 172,131 172,142 198,129" fill="#2246a0" />
        <polygon points="172,105 198,118 172,131 146,118" fill="url(#gwo-adaTip)" />
        <path d="M146,118 L172,105 L198,118" stroke="#dbe8ff" stroke-width="1.2" fill="none" opacity="0.65" />
        <g transform="translate(172 118) matrix(0.56 0.28 -0.56 0.28 0 0) translate(-16 -16)" opacity="0.97">
          <g transform="translate(16 16) scale(0.0853333) translate(-187.5 -173.25)">
            <path d="M102.8,172c-0.8,13.9,9.9,25.8,23.8,26.6c0.5,0,1,0,1.5,0c14,0,25.3-11.3,25.2-25.3c0-14-11.3-25.3-25.3-25.2 C114.6,148.1,103.5,158.6,102.8,172z" fill="#ffffff" />
            <path d="M8.6,165.5c-4.5-0.3-8.4,3.2-8.6,7.7s3.2,8.4,7.7,8.6c4.5,0.3,8.3-3.2,8.6-7.7 C16.6,169.6,13.1,165.8,8.6,165.5C8.6,165.5,8.6,165.5,8.6,165.5z" fill="#ffffff" />
            <path d="M101.2,25.4c4-2,5.6-7,3.6-11c-2-4-7-5.6-11-3.6c-4,2-5.6,6.9-3.6,10.9C92.2,25.8,97.1,27.5,101.2,25.4 C101.1,25.4,101.2,25.4,101.2,25.4z" fill="#ffffff" />
            <path d="M126.8,70.1c6.2-3.1,8.7-10.7,5.6-16.9s-10.7-8.7-16.9-5.6c-6.2,3.1-8.7,10.7-5.6,16.9 C113,70.7,120.6,73.2,126.8,70.1z" fill="#ffffff" />
            <path d="M40.6,100.8c4.8,3.1,11.2,1.8,14.4-3c3.1-4.8,1.8-11.2-3-14.4c-4.8-3.1-11.2-1.8-14.4,3c0,0,0,0,0,0 C34.4,91.2,35.8,97.7,40.6,100.8z" fill="#ffffff" />
            <path d="M55.9,161c-7-0.4-12.9,4.9-13.3,11.9s4.9,12.9,11.9,13.3c7,0.4,12.9-4.9,13.3-11.9c0,0,0,0,0,0 C68.2,167.4,62.9,161.4,55.9,161z" fill="#ffffff" />
            <path d="M42,245.7c-5.1,2.6-7.2,8.8-4.6,14c2.6,5.1,8.8,7.2,14,4.6c5.1-2.6,7.2-8.8,4.6-14c0,0,0,0,0,0 C53.4,245.2,47.1,243.1,42,245.7C42,245.7,42,245.7,42,245.7z" fill="#ffffff" />
            <path d="M91,134.9c6.9,4.5,16.1,2.6,20.5-4.3c4.5-6.9,2.6-16.1-4.3-20.5c-6.9-4.5-16.1-2.6-20.5,4.3 C82.2,121.2,84.1,130.4,91,134.9C91,134.9,91,134.9,91,134.9z" fill="#ffffff" />
            <path d="M246.5,69.1c5.8,3.8,13.7,2.2,17.5-3.6s2.2-13.7-3.6-17.5c-5.8-3.8-13.7-2.2-17.5,3.6c0,0,0,0,0,0 C239,57.5,240.6,65.3,246.5,69.1C246.5,69.1,246.5,69.1,246.5,69.1z" fill="#ffffff" />
            <path d="M272.3,24.6c3.8,2.5,8.8,1.4,11.3-2.4s1.4-8.8-2.4-11.3c-3.8-2.5-8.8-1.4-11.3,2.3 C267.5,17,268.6,22.1,272.3,24.6C272.3,24.6,272.3,24.6,272.3,24.6z" fill="#ffffff" />
            <path d="M248.4,147.9c-13.9-0.8-25.9,9.9-26.6,23.8c-0.8,13.9,9.9,25.9,23.8,26.6c0.5,0,1,0,1.4,0 c13.9,0,25.2-11.3,25.2-25.3C272.3,159.7,261.8,148.6,248.4,147.9L248.4,147.9z" fill="#ffffff" />
            <path d="M135.1,133.1c4.3,8.5,13,13.9,22.6,13.9c13.9,0,25.2-11.3,25.2-25.3c0-3.9-0.9-7.8-2.7-11.4 c-6.3-12.5-21.5-17.5-33.9-11.2C133.8,105.5,128.8,120.7,135.1,133.1L135.1,133.1z" fill="#ffffff" />
            <path d="M333,100.8c5.1-2.6,7.1-8.9,4.5-14c-2.6-5.1-8.9-7.1-14-4.5c-5.1,2.6-7.1,8.8-4.6,13.9 C321.6,101.3,327.8,103.4,333,100.8C333,100.8,333,100.8,333,100.8z" fill="#ffffff" />
            <path d="M269,108.8c-7.3,3.7-10.3,12.6-6.6,19.9c3.7,7.3,12.6,10.3,19.9,6.6c7.3-3.7,10.3-12.6,6.6-19.9 C285.2,108.1,276.3,105.2,269,108.8z" fill="#ffffff" />
            <path d="M186.5,20.8c5.7,0.3,10.6-4.1,11-9.8s-4.1-10.6-9.8-11c-5.7-0.3-10.6,4-11,9.7 C176.4,15.5,180.8,20.4,186.5,20.8C186.5,20.8,186.5,20.8,186.5,20.8z" fill="#ffffff" />
            <path d="M186.4,86.1c8.2,0.5,15.2-5.8,15.6-14c0.5-8.2-5.8-15.2-14-15.6c-8.2-0.5-15.2,5.8-15.6,14 C172,78.7,178.2,85.7,186.4,86.1C186.4,86.1,186.4,86.1,186.4,86.1z" fill="#ffffff" />
            <path d="M106,237.7c7.3-3.7,10.3-12.6,6.6-19.9c-3.7-7.3-12.6-10.3-19.9-6.6c-7.3,3.7-10.3,12.6-6.6,19.9 C89.8,238.4,98.7,241.4,106,237.7z" fill="#ffffff" />
            <path d="M196,107.8c-7.6,11.7-4.4,27.3,7.3,34.9c11.7,7.6,27.3,4.4,34.9-7.3c7.6-11.7,4.4-27.3-7.3-34.9 c-4.1-2.7-8.9-4.1-13.8-4.1C208.6,96.4,200.7,100.7,196,107.8z" fill="#ffffff" />
            <path d="M239.9,213.4c-6.3-12.5-21.5-17.5-33.9-11.2c-12.5,6.3-17.5,21.5-11.2,33.9c6.3,12.5,21.5,17.5,33.9,11.2 c0,0,0,0,0,0c12.4-6.2,17.5-21.2,11.3-33.7C240,213.5,240,213.5,239.9,213.4z" fill="#ffffff" />
            <path d="M284,211.6c-6.9-4.5-16.1-2.6-20.5,4.3c-4.5,6.9-2.6,16.1,4.3,20.5c6.9,4.5,16.1,2.6,20.5-4.3 C292.8,225.3,290.9,216.1,284,211.6C284,211.6,284,211.6,284,211.6z" fill="#ffffff" />
            <path d="M332.4,173.7c0.4-7-4.9-12.9-11.9-13.3c-7-0.4-12.9,4.9-13.3,11.9c-0.4,7,4.9,12.9,11.9,13.3c0,0,0,0,0,0 C326,186,332,180.6,332.4,173.7z" fill="#ffffff" />
            <path d="M367.3,164.7c-4.5-0.3-8.4,3.2-8.6,7.7s3.2,8.4,7.7,8.6c4.5,0.3,8.3-3.2,8.6-7.7 C375.2,168.8,371.8,165,367.3,164.7z" fill="#ffffff" />
            <path d="M334.4,245.7c-4.8-3.1-11.2-1.8-14.4,3c-3.1,4.8-1.8,11.2,3,14.4c4.8,3.1,11.2,1.8,14.4-3 C340.6,255.3,339.2,248.8,334.4,245.7C334.4,245.7,334.4,245.7,334.4,245.7z" fill="#ffffff" />
            <path d="M102.6,321.9c-3.8-2.5-8.8-1.4-11.3,2.3c-2.5,3.8-1.4,8.8,2.3,11.3c3.8,2.5,8.8,1.4,11.3-2.3c0,0,0,0,0,0 C107.5,329.5,106.4,324.4,102.6,321.9z" fill="#ffffff" />
            <path d="M273.8,321.1c-4,2-5.6,7-3.6,11c2,4,7,5.6,11,3.6c4-2,5.6-6.9,3.6-10.9C282.8,320.7,277.9,319,273.8,321.1 C273.9,321.1,273.8,321.1,273.8,321.1z" fill="#ffffff" />
            <path d="M179,238.7c7.6-11.7,4.4-27.3-7.3-35c-11.7-7.6-27.3-4.4-35,7.3s-4.4,27.3,7.3,35c4.1,2.7,8.9,4.1,13.8,4.1 C166.4,250.2,174.3,245.9,179,238.7z" fill="#ffffff" />
            <path d="M128.5,277.4c-5.8-3.8-13.7-2.2-17.5,3.6c-3.8,5.8-2.2,13.7,3.6,17.5s13.7,2.2,17.5-3.6c0,0,0,0,0,0 C136,289.1,134.4,281.2,128.5,277.4z" fill="#ffffff" />
            <path d="M187.4,325.7c-5.7-0.3-10.6,4.1-11,9.8s4.1,10.6,9.8,11c5.7,0.3,10.6-4,11-9.7 C197.5,331,193.1,326.1,187.4,325.7C187.4,325.7,187.4,325.7,187.4,325.7z" fill="#ffffff" />
            <path d="M187.5,260.4c-8.2-0.5-15.2,5.8-15.6,14c-0.5,8.2,5.8,15.2,14,15.6c8.2,0.4,15.2-5.8,15.6-14 C202,267.9,195.7,260.8,187.5,260.4C187.5,260.4,187.5,260.4,187.5,260.4z" fill="#ffffff" />
            <path d="M248.2,276.4c-6.2,3.2-8.7,10.8-5.5,17c3.2,6.2,10.8,8.7,17,5.5c6.2-3.1,8.7-10.7,5.6-16.9 C262.1,275.8,254.5,273.2,248.2,276.4C248.2,276.4,248.2,276.4,248.2,276.4z" fill="#ffffff" />
          </g>
        </g>
      </g>
    </g>

    <!-- Midnight node -->
    <g>
      <polygon points="62,216 100,235 100,243 62,224" fill="#7c8a9c" />
      <polygon points="138,216 100,235 100,243 138,224" fill="#5b6878" />
      <polygon points="100,197 138,216 100,235 62,216" fill="url(#gwo-plate)" />
      <circle cx="78" cy="227" r="2.6" fill="#4d4dff" />
      <circle cx="90" cy="233" r="2.6" fill="#94a3b8" />
      <circle cx="102" cy="239" r="2.6" fill="#64748b" />
      <polygon points="74,204 100,217 100,228 74,215" fill="#343b48" />
      <polygon points="126,204 100,217 100,228 126,215" fill="#232833" />
      <polygon points="100,191 126,204 100,217 74,204" fill="url(#gwo-mdnBlock)" />
      <polygon points="74,190 100,203 100,214 74,201" fill="#343b48" />
      <polygon points="126,190 100,203 100,214 126,201" fill="#232833" />
      <polygon points="100,177 126,190 100,203 74,190" fill="url(#gwo-mdnBlock)" />
      <path d="M74,190 L100,177 L126,190" stroke="#8e99ab" stroke-width="1" fill="none" opacity="0.35" />
      <g class="iso-lift" style="animation-delay: -1.2s">
        <polygon points="74,176 100,189 100,200 74,187" fill="#3b414f" />
        <polygon points="126,176 100,189 100,200 126,187" fill="#272c37" />
        <polygon points="100,163 126,176 100,189 74,176" fill="url(#gwo-mdnTip)" />
        <path d="M74,176 L100,163 L126,176" stroke="#4d4dff" stroke-width="1.4" fill="none" opacity="0.85" />
        <g transform="translate(100 176) matrix(0.56 0.28 -0.56 0.28 0 0) translate(-16 -16)" opacity="0.97">
          <path d="M16,16 m-16,0 a16,16 0 1,0 32,0 a16,16 0 1,0 -32,0 M16,16 m-13.05,0 a13.05,13.05 0 1,0 26.1,0 a13.05,13.05 0 1,0 -26.1,0" fill="#ffffff" fill-rule="evenodd" />
          <rect x="14.5" y="14.5" width="3" height="3" fill="#ffffff" />
          <rect x="14.5" y="9.76" width="3" height="3" fill="#ffffff" />
          <rect x="14.5" y="5.01" width="3" height="3" fill="#ffffff" />
        </g>
      </g>
    </g>

    <!-- Gero core: three plates, lit seams, specular -->
    <g>
      <polygon points="466,178 520,205 520,219 466,192" fill="#0b5f75" />
      <polygon points="574,178 520,205 520,219 574,192" fill="#084b5d" />
      <polygon points="520,151 574,178 520,205 466,178" fill="#0d84a0" />
      <polygon points="466,158 520,185 520,196 466,169" fill="#0f97b6" />
      <polygon points="574,158 520,185 520,196 574,169" fill="#0b7488" />
      <polygon points="520,131 574,158 520,185 466,158" fill="url(#gwo-coreMid)" />
      <path class="iso-seam iso-seam--late" d="M466,158 L520,185 L574,158" stroke="#51e0d0" stroke-width="1.8" fill="none" opacity="0.6" />
      <polygon points="466,140 520,167 520,180 466,153" fill="#12a6c4" />
      <polygon points="574,140 520,167 520,180 574,153" fill="#0d84a0" />
      <polygon points="520,113 574,140 520,167 466,140" fill="url(#gwo-coreTop)" />
      <path class="iso-seam" d="M466,140 L520,167 L574,140" stroke="#7ac6f0" stroke-width="1.8" fill="none" opacity="0.55" />
      <g transform="translate(520 140) matrix(1.24 0.62 -1.24 0.62 0 0) rotate(-45) translate(-16 -16)" opacity="0.92"><g transform="translate(16 16) scale(0.03587) translate(-446.11 -399.885)"><path d="M168.35.05v-.05c.59.16,1.18.32,1.76.48-.59-.11-1.23-.27-1.81-.37,0,0,.05-.05.05-.05ZM626.61,5.4l-.8-.11c0,.75,0,1.5-.05,2.24h0c.27-.7.59-1.44.86-2.13h0ZM872.58,225.74c6.03,29.21,7.16,58.53,2.67,88.01-4.11,26.86-14.52,51.27-29.8,73.7-3.15.59-4.06,3.53-5.87,5.5-15.43,16.56-31.88,31.83-52.92,40.96-3.1,1.34-7,4.38-10.25,1.23-2.67-2.62-.7-6.41.16-9.67,3.74-14.26,7.59-28.52,11.37-42.78,8.17-25.63,17.89-50.41,34.6-72.04,8.54-11.06,13.99-23.98,17.67-37.43,18.37-66.97,2.67-127.85-33.86-184.77-13.78-21.47-32.84-38.4-50.84-56.12-10.15-9.99-20.72-19.6-31.13-29.37-.43,2.29.37,3.53,1.18,4.76,18.69,27.5,39.2,53.83,56.23,82.45,21.04,35.41,33.22,73.43,33.69,114.82.16,11.75-.7,23.5-5.34,34.5-4.27,10.2-12.01,12.92-21.63,7.75-3.53-1.87-6.89-4.22-9.83-6.84-20.46-18.32-34.66-40.69-42.99-66.81-1.12-6.94-2.29-13.89-3.42-20.78.54-41.92-11.75-78.08-45.93-104.99-17.41-13.73-35.35-26.7-53.78-39.09-2.19-1.44-4.27-2.35-6.84-1.23,20.08,14.52,37.65,31.72,53.99,50.2,20.72,23.5,32.31,50.68,32.63,82.29h0c-.48,1.12-1.12,2.19-1.44,3.36-2.78,11.21-3.04,11.48-13.08,6.25-13.08-6.84-25.95-14.21-38.93-21.2-14.74-7.96-26.6-19.81-40.16-29.27-14.95-15.49-27.61-32.63-37.97-51.59,4.7,21.04,13.78,39.9,26.38,57.14,7.37,11.96,17.31,21.68,28.68,29.64,24.99,17.41,49.29,35.51,68.79,59.23,5.77,8.65,11.96,17.09,17.25,26.01,28.25,47.58,41.55,98.74,35.67,154.23-.37,1.5-.91,2.94-1.12,4.43-10.04,60.35-32.74,114.87-73.91,160.85-3.1,3.47-6.03,7.26-10.9,9.61,6.46-48.54-3.31-96.29-24.94-121.44,16.77,53.51,16.93,104.56-16.34,151.88-19.39,27.02-45.5,44.7-76.63,55.86,21.25-34.23,39.63-68.94,35.94-110.86.11-1.87.27-3.74.37-5.55.21-.48.48-.91.64-1.44,0-.16-.32-.37-.54-.59.37-17.31-5.12-33.11-11.75-48.76,1.71,17.04-.11,33.8-1.28,50.63-7.1,37.06-21.57,71.13-43.95,101.36-11.69,15.81-24.72,30.97-43.68,38.88-5.77,2.4-3.42,5.77-1.55,8.81,9.61,15.38,24.46,22.86,41.44,26.97,3.2.8,5.39-.8,7.05-3.2,13.03-18.74,32.2-29.21,52.07-38.72,31.88-15.33,62.69-32.42,90.41-54.63,1.34-.75,2.78-1.34,3.95-2.24,34.44-27.19,63.12-59.76,87.42-96.13,15.33-22.96,31.19-44.59,55.49-59.6,17.73-10.95,33.59-25.15,43.68-44.32.21-.37.54-.75.64-1.18,0-.05-.11-.21-.27-.37,9.88-15.43,15.27-32.36,19.12-50.36,8.92-41.6-1.55-79.94-16.29-117.97l-.05.05h0ZM399.64,657.99c-14.26-6.52-25.53-16.98-35.46-28.94-23.02-27.71-36.85-60.02-46.67-94.26-3.26-22.05-8.01-44-4.01-66.65-2.94,5.45-5.07,10.9-6.73,16.45-6.52,22.05-9.35,44.43-4.27,67.24,4.17,31.88,19.28,59.17,36.69,85.5-38.08-16.61-71.03-38.56-90.63-76.15-11.32-25.53-16.61-52.12-14.52-80.11,1.39-18.42,4.76-36.48,10.74-54.04-23.39,35.94-32.26,75.3-25.42,119.3-12.6-8.54-34.18-35.73-45.18-55.06-22.38-39.41-35.73-81.7-40.85-126.67-1.23-10.68-.96-21.36.11-31.99.32-.43.37-.86.16-1.34,4.76-52.71,23.82-99.71,56.45-141.25,18.48-21.15,41.44-37.06,63.55-53.99,6.94-5.28,14.47-10.36,19.17-18.21,19.6-21.63,33.33-46.41,40.42-74.77-14.15,27.98-34.34,50.89-57.94,71.03-2.99.32-4.8,2.67-7,4.22-17.62,12.6-36.26,23.34-56.07,32.15-8.92,3.95-10.63,2.99-11.64-6.78-.64-6.41-1.02-12.82-1.5-19.23.43-.11.7-.43.7-.86.05-.59.11-1.18.16-1.81,2.03-20.56,10.58-38.45,22.75-54.79,14.68-19.65,32.58-36.21,51.11-52.07,2.78-2.35,5.45-4.8,8.17-7.21-.54-.54-1.07-1.12-1.6-1.65-24.72,16.66-49.29,33.43-70.6,54.63-18.64,18.53-27.13,41.28-29.69,66.86l-.54.59s.43.64.43.7c.16-.21.21-.48.21-.7,0,.27-.05.48-.21.7,0,1.65,0,3.31-.05,4.96-3.79,13.03-1.65,26.81-4.91,39.9-4.91,17.73-13.89,33.49-24.56,48.33-6.68,9.29-14.21,17.94-24.14,23.98-12.71,7.69-21.95,4.43-26.38-9.67-1.71-5.55-2.78-11.37-3.26-17.2-3.36-41.17,6.78-79.46,25.47-115.89,16.4-31.94,38.88-59.76,59.33-89.02,2.99-4.22,8.6-7.48,6.89-14.1h0c-14.37,13.83-28.46,28.04-43.21,41.49-38.13,34.82-64.3,76.63-75.67,127.31-10.63,47.21-9.51,93.51,15.91,135.97,13.62,22.8,26.76,45.5,35.35,70.65,4.96,17.73,9.88,35.51,14.95,53.19,2.19,7.59-.75,9.13-7.32,6.62-8.33-3.15-16.13-7.37-23.45-12.5-19.65-13.78-35.62-31.08-48.81-51.05-23.82-43.25-26.44-89.45-18.05-137.35-3.36.54-3.15,2.51-3.58,3.69-11.64,30.07-16.61,61.31-13.57,93.4,2.08,21.89,7.69,42.94,20.08,61.63.75,5.18,4.43,8.7,7.32,12.6,13.03,17.62,29.96,30.97,47.96,42.99,10.15,6.78,18.96,14.63,25.9,24.72,12.71,18.53,25.15,37.33,39.41,54.74,19.33,23.66,39.68,46.3,64.62,64.35,27.29,23.82,57.78,42.78,90.36,58.37,21.52,10.31,42.51,21.2,57.35,40.75,1.92,2.56,4.17,3.58,7.16,2.78,16.77-4.38,31.88-11.21,41.49-26.81,2.83-4.6,2.83-7.1-2.78-9.61l-.11-.05h0ZM376.41,767.09c-13.99-10.42-29.05-14.37-44.59-12.98-5.55.48-10.15,2.29-12.39,9.4-.43,1.34-1.39,2.29-2.13,3.42,3.15,4.33,6.03,9.02,9.4,12.98,9.4,10.9,20.56,13.46,32.1,13.03,4.17-.16,8.33-.86,12.44-1.44,10.68-1.44,20.93.8,30.7,8.28.64-.86.11-1.5-.32-2.19-6.94-12.23-15.22-23.02-25.26-30.49h.05ZM560.39,754.06c-15.54-1.34-30.6,2.62-44.59,13.03-10.04,7.48-18.32,18.26-25.26,30.49-.37.7-.96,1.34-.32,2.19,9.77-7.48,20.03-9.72,30.7-8.28,4.17.54,8.28,1.28,12.44,1.44,11.53.37,22.7-2.19,32.1-13.08,3.42-3.95,6.3-8.65,9.4-12.98-.75-1.12-1.71-2.08-2.13-3.42-2.24-7.1-6.89-8.92-12.39-9.4h.05,0Z" fill="#ffffff" /></g></g>
    </g>
  </svg>
</template>
<script setup lang="ts">
// Pure presentational scene; all data is baked geometry.
</script>
<style scoped>
.iso-multichain {
  display: block;
  width: 100%;
  height: auto;
}

/* Isometric animation catalog (Nexus icon build spec). Loop sync law:
   durations are 3.2s or exact divisors; staggers negative only. Animated
   transforms need transform-box: fill-box (SVG's default origin is the
   viewBox corner, not the shape). */
@keyframes iso-lift { from { transform: translateY(0); } to { transform: translateY(-3px); } }
@keyframes iso-beam { to { stroke-dashoffset: -24; } }
@keyframes iso-pkt-run { from { offset-distance: 0%; } to { offset-distance: 100%; } }
@keyframes iso-seam { from { opacity: 0.5; } to { opacity: 0.9; } }

.iso-lift {
  animation: iso-lift 1.6s ease-in-out infinite alternate;
  transform-box: fill-box;
  transform-origin: center;
}

.iso-beam { animation: iso-beam 1.6s linear infinite; }
.iso-seam { animation: iso-seam 1.6s ease-in-out infinite alternate; }
.iso-seam--late { animation-delay: -0.8s; }

/* Packets ride their beam via offset-path. fill-mode: backwards is the
   seatbelt for the negatively-delayed ones (they paint stuck on first load
   otherwise); the inline offset-distance doubles as the reduced-motion
   parking spot once the animation is off. */
.iso-pkt {
  offset-rotate: 0deg;
  transform-box: fill-box;
  transform-origin: center;
  animation: iso-pkt-run 3.2s linear infinite;
  animation-fill-mode: backwards;
}

@media (prefers-reduced-motion: reduce) {
  .iso-lift,
  .iso-beam,
  .iso-pkt {
    animation: none;
  }

  .iso-seam { animation: none; opacity: 0.7; }
}
</style>
