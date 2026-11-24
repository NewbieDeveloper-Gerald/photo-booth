export type LayoutPlacement = { slot: number; x: number; y: number; width: number; height: number };
export type LayoutPreset = {
  id: string; name: string; shots: number; copies: number; width: number; height: number; background: string; frameColor: string; gutter: number;
  header: { text: string; color: string; fontSize: number }; footer: { text: string; color: string; fontSize: number };
  placements: LayoutPlacement[];
};
export const layoutPresets: LayoutPreset[] = [
  {
    "id": "double-strip-4",
    "name": "4 photos \u00b7 2 strips",
    "shots": 4,
    "copies": 2,
    "width": 1200,
    "height": 1800,
    "background": "#f4f0ec",
    "frameColor": "#c90000",
    "gutter": 12,
    "header": {
      "text": "RPHOTOSHOOT \u00b7 {{eventName}}",
      "color": "#ffffff",
      "fontSize": 30
    },
    "footer": {
      "text": "CAPTURING MOMENTS, CREATING MEMORIES",
      "color": "#ffffff",
      "fontSize": 18
    },
    "placements": [
      {
        "slot": 1,
        "x": 48,
        "y": 110,
        "width": 526,
        "height": 386
      },
      {
        "slot": 2,
        "x": 48,
        "y": 508,
        "width": 526,
        "height": 386
      },
      {
        "slot": 3,
        "x": 48,
        "y": 906,
        "width": 526,
        "height": 386
      },
      {
        "slot": 4,
        "x": 48,
        "y": 1304,
        "width": 526,
        "height": 386
      },
      {
        "slot": 1,
        "x": 626,
        "y": 110,
        "width": 526,
        "height": 386
      },
      {
        "slot": 2,
        "x": 626,
        "y": 508,
        "width": 526,
        "height": 386
      },
      {
        "slot": 3,
        "x": 626,
        "y": 906,
        "width": 526,
        "height": 386
      },
      {
        "slot": 4,
        "x": 626,
        "y": 1304,
        "width": 526,
        "height": 386
      }
    ]
  },
  {
    "id": "grid-4-portrait",
    "name": "4 photos \u00b7 portrait grid",
    "shots": 4,
    "copies": 1,
    "width": 1200,
    "height": 1800,
    "background": "#f4f0ec",
    "frameColor": "#c90000",
    "gutter": 12,
    "header": {
      "text": "RPHOTOSHOOT \u00b7 {{eventName}}",
      "color": "#ffffff",
      "fontSize": 30
    },
    "footer": {
      "text": "CAPTURING MOMENTS, CREATING MEMORIES",
      "color": "#ffffff",
      "fontSize": 18
    },
    "placements": [
      {
        "slot": 1,
        "x": 60,
        "y": 180,
        "width": 534,
        "height": 728
      },
      {
        "slot": 2,
        "x": 606,
        "y": 180,
        "width": 534,
        "height": 728
      },
      {
        "slot": 3,
        "x": 60,
        "y": 920,
        "width": 534,
        "height": 728
      },
      {
        "slot": 4,
        "x": 606,
        "y": 920,
        "width": 534,
        "height": 728
      }
    ]
  },
  {
    "id": "double-strip-2",
    "name": "2 photos \u00b7 2 strips",
    "shots": 2,
    "copies": 2,
    "width": 1200,
    "height": 1800,
    "background": "#f4f0ec",
    "frameColor": "#c90000",
    "gutter": 12,
    "header": {
      "text": "RPHOTOSHOOT \u00b7 {{eventName}}",
      "color": "#ffffff",
      "fontSize": 30
    },
    "footer": {
      "text": "CAPTURING MOMENTS, CREATING MEMORIES",
      "color": "#ffffff",
      "fontSize": 18
    },
    "placements": [
      {
        "slot": 1,
        "x": 48,
        "y": 210,
        "width": 526,
        "height": 684
      },
      {
        "slot": 2,
        "x": 48,
        "y": 906,
        "width": 526,
        "height": 684
      },
      {
        "slot": 1,
        "x": 626,
        "y": 210,
        "width": 526,
        "height": 684
      },
      {
        "slot": 2,
        "x": 626,
        "y": 906,
        "width": 526,
        "height": 684
      }
    ]
  },
  {
    "id": "single-2-portrait",
    "name": "2 photos \u00b7 single portrait",
    "shots": 2,
    "copies": 1,
    "width": 1200,
    "height": 1800,
    "background": "#f4f0ec",
    "frameColor": "#c90000",
    "gutter": 12,
    "header": {
      "text": "RPHOTOSHOOT \u00b7 {{eventName}}",
      "color": "#ffffff",
      "fontSize": 30
    },
    "footer": {
      "text": "CAPTURING MOMENTS, CREATING MEMORIES",
      "color": "#ffffff",
      "fontSize": 18
    },
    "placements": [
      {
        "slot": 1,
        "x": 60,
        "y": 210,
        "width": 1080,
        "height": 708
      },
      {
        "slot": 2,
        "x": 60,
        "y": 930,
        "width": 1080,
        "height": 708
      }
    ]
  },
  {
    "id": "double-strip-3",
    "name": "3 photos \u00b7 2 strips",
    "shots": 3,
    "copies": 2,
    "width": 1200,
    "height": 1800,
    "background": "#f4f0ec",
    "frameColor": "#c90000",
    "gutter": 12,
    "header": {
      "text": "RPHOTOSHOOT \u00b7 {{eventName}}",
      "color": "#ffffff",
      "fontSize": 30
    },
    "footer": {
      "text": "CAPTURING MOMENTS, CREATING MEMORIES",
      "color": "#ffffff",
      "fontSize": 18
    },
    "placements": [
      {
        "slot": 1,
        "x": 48,
        "y": 110,
        "width": 526,
        "height": 518
      },
      {
        "slot": 2,
        "x": 48,
        "y": 640,
        "width": 526,
        "height": 518
      },
      {
        "slot": 3,
        "x": 48,
        "y": 1170,
        "width": 526,
        "height": 518
      },
      {
        "slot": 1,
        "x": 626,
        "y": 110,
        "width": 526,
        "height": 518
      },
      {
        "slot": 2,
        "x": 626,
        "y": 640,
        "width": 526,
        "height": 518
      },
      {
        "slot": 3,
        "x": 626,
        "y": 1170,
        "width": 526,
        "height": 518
      }
    ]
  },
  {
    "id": "grid-4-landscape",
    "name": "4 photos \u00b7 landscape grid",
    "shots": 4,
    "copies": 1,
    "width": 1800,
    "height": 1200,
    "background": "#f4f0ec",
    "frameColor": "#c90000",
    "gutter": 12,
    "header": {
      "text": "RPHOTOSHOOT \u00b7 {{eventName}}",
      "color": "#ffffff",
      "fontSize": 30
    },
    "footer": {
      "text": "CAPTURING MOMENTS, CREATING MEMORIES",
      "color": "#ffffff",
      "fontSize": 18
    },
    "placements": [
      {
        "slot": 1,
        "x": 60,
        "y": 150,
        "width": 834,
        "height": 438
      },
      {
        "slot": 2,
        "x": 906,
        "y": 150,
        "width": 834,
        "height": 438
      },
      {
        "slot": 3,
        "x": 60,
        "y": 600,
        "width": 834,
        "height": 438
      },
      {
        "slot": 4,
        "x": 906,
        "y": 600,
        "width": 834,
        "height": 438
      }
    ]
  }
];
export function getLayoutPreset(layoutId: unknown): LayoutPreset {
  const found = layoutPresets.find((layout) => layout.id === layoutId);
  if (!found) throw new Error('Choose a supported photo layout');
  return found;
}
