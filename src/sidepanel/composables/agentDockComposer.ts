// src/sidepanel/composables/agentDockComposer.ts
import { ref, type Ref } from 'vue';

export type DockMode = 'copilot' | 'support';

export interface AgentDockComposer {
  draft: Ref<string>;
  mode: Ref<DockMode>;
  pendingFiles: Ref<File[]>;
}

// The dock's unsent composer state. It lives outside AgentDock because crossing layouts
// (dashboard <-> Help, whose HelpLayout renders its own ContentLayout) replaces the dock, and
// Vue 2 creates the new instance before it destroys the old one, so the state cannot be
// handed over on unmount. The new dock takes it over only during that overlap. A dock that
// mounts while no other dock is alive starts empty, as it always has: nothing typed survives
// a stretch without a dock (lock screen, welcome flow), where no dock watched for the lock or
// wallet change that clears it.
const composer: AgentDockComposer = {
  draft: ref(''),
  mode: ref<DockMode>('support'),
  pendingFiles: ref<File[]>([]),
};
let liveDocks = 0;

function reset(): void {
  composer.draft.value = '';
  composer.mode.value = 'support';
  composer.pendingFiles.value = [];
}

export function attachAgentDockComposer(): AgentDockComposer {
  if (liveDocks === 0) reset();
  liveDocks += 1;
  return composer;
}

export function detachAgentDockComposer(): void {
  liveDocks = Math.max(0, liveDocks - 1);
}
