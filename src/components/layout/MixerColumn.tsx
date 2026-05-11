import { MixerPanel } from '../Mixer';

export function MixerColumn() {
  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-hidden bg-[#161616]">
      <MixerPanel />
    </div>
  );
}
