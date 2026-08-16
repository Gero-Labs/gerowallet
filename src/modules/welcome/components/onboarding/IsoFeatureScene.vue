<template>
  <!-- Single-idea isometric feature tiles on the Nexus icon grammar:
       cube geometry, shared gradient palette, catalog motion on the 3.2s
       master loop. One scene per `kind`. -->
  <svg v-if="kind === 'security'" viewBox="0 0 120 120" class="iso-feature" aria-hidden="true">
    <defs><linearGradient id="isoG-cyan-sec" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#86e9f5" /><stop offset="1" stop-color="#37c6dd" /></linearGradient><linearGradient id="isoG-navy-sec" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#46597a" /><stop offset="1" stop-color="#2e415f" /></linearGradient></defs>
    <ellipse cx="60" cy="100" rx="38" ry="8" fill="#0e2a3d" opacity="0.12" />
    <polygon points="30,78 60,93 60,103 30,88" fill="#22334d" />
    <polygon points="90,78 60,93 60,103 90,88" fill="#172538" />
    <polygon points="60,63 90,78 60,93 30,78" fill="url(#isoG-navy-sec)" />
    <polygon points="43,58 60,66.5 60,82.5 43,74" fill="#12a6c4" />
    <polygon points="77,58 60,66.5 60,82.5 77,74" fill="#0d84a0" />
    <polygon points="60,49.5 77,58 60,66.5 43,58" fill="url(#isoG-cyan-sec)" />
    <circle cx="66" cy="72" r="2.4" fill="#0e2a3d" opacity="0.55" />
    <line x1="66" y1="74" x2="66" y2="78" stroke="#0e2a3d" stroke-width="2" opacity="0.55" />
    <circle cx="80" cy="78" r="2" fill="#00CCBB" class="iso-blink" />
    <circle cx="60" cy="28" r="11" fill="#00CCBB" opacity="0.25" class="iso-halo" />
    <g class="iso-bob">
      <path d="M60,18 l9,3.4 v6.2 c0,5.6 -3.8,9 -9,11.4 c-5.2,-2.4 -9,-5.8 -9,-11.4 v-6.2 z" fill="none" stroke="#00CCBB" stroke-width="2.2" stroke-linejoin="round" />
      <path d="M55.5,28 l3.2,3.2 l6,-6.4" fill="none" stroke="#00CCBB" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
    </g>
  </svg>

  <svg v-else-if="kind === 'earn'" viewBox="0 0 120 120" class="iso-feature" aria-hidden="true">
    <defs><linearGradient id="isoG-navy-earn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#46597a" /><stop offset="1" stop-color="#2e415f" /></linearGradient><linearGradient id="isoG-green-earn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8ceebb" /><stop offset="1" stop-color="#34cd77" /></linearGradient></defs>
    <ellipse cx="60" cy="101" rx="38" ry="8" fill="#0e2a3d" opacity="0.12" />
    <polygon points="25,76 34,80.5 34,94.5 25,90" fill="#22334d" />
    <polygon points="43,76 34,80.5 34,94.5 43,90" fill="#172538" />
    <polygon points="34,71.5 43,76 34,80.5 25,76" fill="url(#isoG-navy-earn)" />
    <polygon points="48,68 57,72.5 57,94.5 48,90" fill="#22334d" />
    <polygon points="66,68 57,72.5 57,94.5 66,90" fill="#172538" />
    <polygon points="57,63.5 66,68 57,72.5 48,68" fill="url(#isoG-navy-earn)" />
    <g class="iso-grow">
      <polygon points="71,60 80,64.5 80,94.5 71,90" fill="#1eb567" />
      <polygon points="89,60 80,64.5 80,94.5 89,90" fill="#158f50" />
      <polygon points="80,55.5 89,60 80,64.5 71,60" fill="url(#isoG-green-earn)" />
    </g>
    <path d="M24,60 L48,52 L66,44 L90,31" pathLength="100" stroke-dasharray="100 100" stroke="#00CCBB" stroke-width="3" fill="none" stroke-linecap="round" class="iso-draw" />
    <polygon points="96.4,27.6 92.5,33.1 89.7,27.8" fill="#00CCBB" class="iso-head" />
  </svg>

  <svg v-else viewBox="0 0 120 120" class="iso-feature" aria-hidden="true">
    <defs><linearGradient id="isoG-cyan-cb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#86e9f5" /><stop offset="1" stop-color="#37c6dd" /></linearGradient><linearGradient id="isoG-green-cb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8ceebb" /><stop offset="1" stop-color="#34cd77" /></linearGradient></defs>
    <ellipse cx="60" cy="96" rx="36" ry="7" fill="#0e2a3d" opacity="0.12" />
    <!-- Sandwich paint: side faces, guide, the travelling coin, THEN the top
         face - so the coin drops along the guide and is swallowed by the
         card instead of landing on top of it. -->
    <polygon points="34,76 60,89 60,97 34,84" fill="#12a6c4" />
    <polygon points="86,76 60,89 60,97 86,84" fill="#0d84a0" />
    <path d="M60,30 L60,56" stroke="#00A8C8" stroke-width="2.2" fill="none" stroke-dasharray="4 4" class="iso-flow-b" />
    <g class="iso-drop" style="offset-path: path('M60,22 L60,58'); offset-distance: 40%">
      <path d="M-8,0 v5 a8,4 0 0 0 16,0 v-5" fill="#158f50" />
      <ellipse cx="0" cy="0" rx="8" ry="4" fill="url(#isoG-green-cb)" />
      <ellipse cx="0" cy="0" rx="4.6" ry="2.3" fill="none" stroke="#0e2a3d" stroke-width="1.4" opacity="0.35" />
    </g>
    <polygon points="60,63 86,76 60,89 34,76" fill="url(#isoG-cyan-cb)" />
  </svg>
</template>
<script setup lang="ts">
defineProps<{ kind: 'security' | 'earn' | 'cashback' }>();
</script>
<style scoped>
.iso-feature {
  display: block;
  width: 100%;
  height: auto;
}

/* Catalog motion (Nexus icon build spec): 3.2s master loop, 1.6s divisor,
   fill-box origins on animated transforms. */
@keyframes iso-bob { from { transform: translateY(0); } to { transform: translateY(-2.5px); } }
@keyframes iso-flow-b { to { stroke-dashoffset: -16; } }
@keyframes iso-blink { 0%, 55% { opacity: 1; } 60%, 80% { opacity: 0.15; } 85%, 100% { opacity: 1; } }
@keyframes iso-grow { from { transform: scaleY(1); } to { transform: scaleY(1.12); } }
@keyframes iso-drop-run { from { offset-distance: 0%; } to { offset-distance: 100%; } }
@keyframes iso-halo { 0%, 100% { transform: scale(1); opacity: 0.25; } 50% { transform: scale(1.23); opacity: 0.12; } }
@keyframes iso-draw { 0% { stroke-dashoffset: 100; } 45%, 90% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: 0; } }
@keyframes iso-head { 0%, 38% { opacity: 0; } 52%, 100% { opacity: 1; } }

.iso-bob {
  animation: iso-bob 1.6s ease-in-out infinite alternate;
  transform-box: fill-box;
  transform-origin: center;
}

.iso-flow-b { animation: iso-flow-b 1.6s linear infinite; }
.iso-blink { animation: iso-blink 3.2s linear infinite; }

.iso-grow {
  animation: iso-grow 1.6s ease-in-out infinite alternate;
  transform-box: fill-box;
  transform-origin: bottom;
}

/* The coin rides the drop guide; the inline offset-distance doubles as the
   reduced-motion parking spot once the animation is off. */
.iso-drop {
  offset-rotate: 0deg;
  transform-box: fill-box;
  transform-origin: center;
  animation: iso-drop-run 3.2s linear infinite;
}

.iso-halo {
  animation: iso-halo 3.2s ease-in-out infinite;
  transform-box: fill-box;
  transform-origin: center;
}

.iso-draw { animation: iso-draw 3.2s ease-in-out infinite; }
.iso-head { animation: iso-head 3.2s linear infinite; }

@media (prefers-reduced-motion: reduce) {
  .iso-bob,
  .iso-flow-b,
  .iso-halo,
  .iso-draw,
  .iso-head,
  .iso-blink,
  .iso-grow,
  .iso-drop {
    animation: none;
  }

  .iso-draw { stroke-dashoffset: 0; }
  .iso-head { opacity: 1; }
}
</style>
