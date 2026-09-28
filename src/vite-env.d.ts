/// <reference types="vite/client" />

declare module 'roughjs/bundled/rough.esm' {
  export interface RoughConfig {
    stroke?: string;
    strokeWidth?: number;
    roughness?: number;
    bowing?: number;
    fill?: string;
    fillStyle?: string;
    fillWeight?: number;
    hachureAngle?: number;
    hachureGap?: number;
    curveStepCount?: number;
    seed?: number;
    rx?: number;
    ry?: number;
  }

  export interface RoughSVG {
    rectangle(x: number, y: number, width: number, height: number, options?: RoughConfig): SVGElement;
    circle(x: number, y: number, diameter: number, options?: RoughConfig): SVGElement;
    line(x1: number, y1: number, x2: number, y2: number, options?: RoughConfig): SVGElement;
    polygon(points: number[][], options?: RoughConfig): SVGElement;
    path(d: string, options?: RoughConfig): SVGElement;
    ellipse(x: number, y: number, width: number, height: number, options?: RoughConfig): SVGElement;
  }

  export interface RoughCanvas {
    rectangle(x: number, y: number, width: number, height: number, options?: RoughConfig): void;
    circle(x: number, y: number, diameter: number, options?: RoughConfig): void;
    line(x1: number, y1: number, x2: number, y2: number, options?: RoughConfig): void;
    polygon(points: number[][], options?: RoughConfig): void;
    path(d: string, options?: RoughConfig): void;
    ellipse(x: number, y: number, width: number, height: number, options?: RoughConfig): void;
  }

  function svg(svg: SVGSVGElement): RoughSVG;
  function canvas(canvas: HTMLCanvasElement): RoughCanvas;

  export default {
    svg,
    canvas,
  };
}
