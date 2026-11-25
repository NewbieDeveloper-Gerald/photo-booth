import { describe, expect, it } from 'vitest';
import {
  SIMULATED_DEVICE_ID, SIMULATED_LABEL, createSimulatedCamera, isSimulatedDeviceId,
  type SimulatedCanvas,
} from './simulated-camera';

function fakeCanvas(size = { width: 0, height: 0 }): SimulatedCanvas & { drawn: number; dataUrlCalls: number } {
  const canvas = {
    width: size.width,
    height: size.height,
    drawn: 0,
    dataUrlCalls: 0,
    getContext: () => ({
      fillStyle: '', font: '', textAlign: '',
      fillRect: () => { canvas.drawn += 1; },
      fillText: () => undefined,
    }),
    captureStream: () => ({ getTracks: () => [] } as unknown as MediaStream),
    toDataURL: () => { canvas.dataUrlCalls += 1; return 'data:image/jpeg;base64,/9j/4Q=='; },
  };
  return canvas;
}

describe('simulated camera (test mode)', () => {
  it('lists itself with a name an operator can recognise as not real', async () => {
    const camera = createSimulatedCamera({ createCanvas: () => fakeCanvas() });
    expect(await camera.listCameras()).toEqual([{ deviceId: SIMULATED_DEVICE_ID, label: SIMULATED_LABEL }]);
    expect(isSimulatedDeviceId(SIMULATED_DEVICE_ID)).toBe(true);
    expect(isSimulatedDeviceId('edsdk:0')).toBe(false);
  });

  it('draws frames on a timer and stops drawing when the preview stops', async () => {
    const canvas = fakeCanvas();
    const queue: Array<() => void> = [];
    const camera = createSimulatedCamera({
      createCanvas: () => canvas,
      setInterval: (callback) => { queue.push(callback); return queue.length; },
      clearInterval: () => { queue.length = 0; },
    });
    const stream = await camera.startPreview(SIMULATED_DEVICE_ID, 'best');
    expect(stream).toBeDefined();
    const drawnAtStart = canvas.drawn;
    queue.splice(0).forEach((callback) => callback());
    expect(canvas.drawn).toBeGreaterThan(drawnAtStart);
    camera.stopPreview(stream);
    expect(queue).toHaveLength(0);
  });

  it('hands back real JPEG bytes for the still, so the photo pipeline gets pixels', async () => {
    const canvas = fakeCanvas();
    const camera = createSimulatedCamera({ createCanvas: () => canvas });
    const bytes = await camera.captureStill();
    expect(canvas.dataUrlCalls).toBe(1);
    expect([...bytes]).toEqual([0xff, 0xd8, 0xff, 0xe1]);
    expect(canvas.width).toBe(2400);
    expect(canvas.height).toBe(1600);
  });

  it('fails loudly if the canvas cannot encode rather than handing over an empty photo', async () => {
    const camera = createSimulatedCamera({ createCanvas: () => { const canvas = fakeCanvas(); canvas.toDataURL = () => ''; return canvas; } });
    await expect(camera.captureStill()).rejects.toThrow('could not encode a photo');
  });

  it('accepts the settings an operator sets, so the panel behaves as it would on a body', () => {
    const camera = createSimulatedCamera({ createCanvas: () => fakeCanvas() });
    expect(camera.applySettings({ iso: '800', aperture: 'f/2.8' })).toEqual({ iso: '800', aperture: 'f/2.8' });
  });
});
