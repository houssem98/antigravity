import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, Time, CreatePriceLineOptions } from 'lightweight-charts';

import { isCryptoAsset } from '../../constants/tradingAssets';
import { calculateSMA, calculateEMA, calculateRSI, calculateMACD } from '../../utils/indicators';
export interface ChartRef {
  addPriceLine: (options: CreatePriceLineOptions) => void;
  clearLines: () => void;
  setMarkers: (markers: any[]) => void;
  addBox: (top: number, bottom: number, color: string, startTime?: number, endTime?: number, text?: string) => void;
  addTrendLine: (p1: { time: number, price: number }, p2: { time: number, price: number }, color: string, lineWidth?: number, lineStyle?: number, text?: string) => void;
  addVerticalLine: (time: number, color: string, lineWidth?: number, lineStyle?: number) => void;
  addText: (time: number, price: number, text: string, color: string) => void;
  addFibonacci: (p1: { time: number, price: number }, p2: { time: number, price: number }, color: string, lineWidth?: number, lineStyle?: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  pan: (direction: 'left' | 'right') => void;
  getDrawings: () => any[];
  setDrawings: (drawings: any[]) => void;
}

export interface ChartColors {
  upColor: string;
  downColor: string;
  borderVisible: boolean;
  wickVisible: boolean;
}

interface ChartProps {
  asset: string;
  timeframe: string;
  colors?: ChartColors;
  activeIndicators?: string[];
  activeTool?: string | null;
  drawingPoints?: { time: number, price: number }[];
  drawingConfig?: { color: string, lineWidth: number, lineStyle: number, text?: string };
  onChartClick?: (time: number, price: number) => void;
  onDrawComplete?: (type: string, p1: any, p2: any) => void;
}

export const Chart = forwardRef<ChartRef, ChartProps>(({ asset, timeframe, colors, activeIndicators = ['SMA 20', 'SMA 50'], activeTool, drawingPoints, drawingConfig, onChartClick, onDrawComplete }, ref) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const linesRef = useRef<any[]>([]);
  const boxesRef = useRef<HTMLDivElement[]>([]);
  const svgContainerRef = useRef<SVGSVGElement | null>(null);
  const previewLineRef = useRef<SVGLineElement | null>(null);
  const previewBoxRef = useRef<SVGRectElement | null>(null);
  const markersPluginRef = useRef<any>(null);
  const fullDataRef = useRef<any[]>([]);
  const drawingsStateRef = useRef<any[]>([]);
  const selectedDrawingRef = useRef<{ element: HTMLElement | SVGElement, remove: () => void } | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingRef.current) {
        selectedDrawingRef.current.remove();
        selectedDrawingRef.current = null;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useImperativeHandle(ref, () => ({
    getDrawings: () => {
      if (!chartRef.current) return [];
      const chart = chartRef.current;
      return drawingsStateRef.current.map(d => {
        const state = d.getState();
        // Convert logical to time
        if (state.logical1 !== undefined && state.logical1 !== null) {
          const x = chart.timeScale().logicalToCoordinate(state.logical1);
          if (x !== null) state.time1 = chart.timeScale().coordinateToTime(x);
        }
        if (state.logical2 !== undefined && state.logical2 !== null) {
          const x = chart.timeScale().logicalToCoordinate(state.logical2);
          if (x !== null) state.time2 = chart.timeScale().coordinateToTime(x);
        }
        return state;
      });
    },
    setDrawings(drawings: any[]) {
      // Clear existing drawings
      if (seriesRef.current) {
        linesRef.current.forEach((line) => {
          seriesRef.current?.removePriceLine(line);
        });
        linesRef.current = [];
      }
      boxesRef.current.forEach(box => box.remove());
      boxesRef.current = [];
      if (svgContainerRef.current) {
        svgContainerRef.current.innerHTML = '';
      }
      drawingsStateRef.current = [];
      selectedDrawingRef.current = null;

      // Re-add drawings
      drawings.forEach(d => {
        if (d.type === 'box') {
          this.addBox(d.price1, d.price2, d.color, d.time1, d.time2, d.text);
        } else if (d.type === 'trendLine') {
          this.addTrendLine({ time: d.time1, price: d.price1 }, { time: d.time2, price: d.price2 }, d.color, d.lineWidth, d.lineStyle, d.text);
        } else if (d.type === 'verticalLine') {
          this.addVerticalLine(d.time1, d.color, d.lineWidth, d.lineStyle);
        } else if (d.type === 'text') {
          this.addText(d.time1, d.price1, d.text, d.color);
        } else if (d.type === 'fibonacci') {
          this.addFibonacci({ time: d.time1, price: d.price1 }, { time: d.time2, price: d.price2 }, d.color, d.lineWidth, d.lineStyle);
        }
      });
    },
    addPriceLine: (options: CreatePriceLineOptions) => {
      if (seriesRef.current) {
        const line = seriesRef.current.createPriceLine(options);
        linesRef.current.push(line);
      }
    },
    clearLines: () => {
      if (seriesRef.current) {
        linesRef.current.forEach((line) => {
          seriesRef.current?.removePriceLine(line);
        });
        linesRef.current = [];
      }
      // Clear boxes
      boxesRef.current.forEach(box => box.remove());
      boxesRef.current = [];
      if (svgContainerRef.current) {
        svgContainerRef.current.innerHTML = '';
      }
      drawingsStateRef.current = [];
      selectedDrawingRef.current = null;
    },
    zoomIn: () => {
      if (!chartRef.current) return;
      const timeScale = chartRef.current.timeScale();
      const visibleRange = timeScale.getVisibleLogicalRange();
      if (visibleRange) {
        const diff = visibleRange.to - visibleRange.from;
        timeScale.setVisibleLogicalRange({
          from: visibleRange.from + diff * 0.1,
          to: visibleRange.to - diff * 0.1,
        });
      }
    },
    zoomOut: () => {
      if (!chartRef.current) return;
      const timeScale = chartRef.current.timeScale();
      const visibleRange = timeScale.getVisibleLogicalRange();
      if (visibleRange) {
        const diff = visibleRange.to - visibleRange.from;
        timeScale.setVisibleLogicalRange({
          from: visibleRange.from - diff * 0.1,
          to: visibleRange.to + diff * 0.1,
        });
      }
    },
    pan: (direction: 'left' | 'right') => {
      if (!chartRef.current) return;
      const timeScale = chartRef.current.timeScale();
      const visibleRange = timeScale.getVisibleLogicalRange();
      if (visibleRange) {
        const diff = visibleRange.to - visibleRange.from;
        const shift = direction === 'left' ? -diff * 0.1 : diff * 0.1;
        timeScale.setVisibleLogicalRange({
          from: visibleRange.from + shift,
          to: visibleRange.to + shift,
        });
      }
    },
    setMarkers: (markers: any[]) => {
      if (seriesRef.current) {
        if (!markersPluginRef.current) {
          markersPluginRef.current = createSeriesMarkers(seriesRef.current, markers);
        } else {
          markersPluginRef.current.setMarkers(markers);
        }
      }
    },
    addBox: (top: number, bottom: number, color: string, startTime?: number, endTime?: number, text?: string) => {
      if (!chartRef.current || !seriesRef.current || !chartContainerRef.current) return;

      const chart = chartRef.current;
      const series = seriesRef.current;
      const container = chartContainerRef.current;

      let logicalStart = startTime ? (chart.timeScale() as any).timeToLogical(startTime as Time) : null;
      let logicalEnd = endTime ? (chart.timeScale() as any).timeToLogical(endTime as Time) : null;
      let priceTop = top;
      let priceBottom = bottom;

      // Create a div for the box
      const box = document.createElement('div');
      box.style.position = 'absolute';
      box.style.backgroundColor = color;
      box.style.pointerEvents = 'auto';
      box.style.cursor = 'move';
      box.style.zIndex = '5';
      box.style.touchAction = 'none';

      const baseColor = color.replace(/[\d.]+\)$/g, '1)').replace('rgba', 'rgb');
      box.style.border = `1px solid ${baseColor}`;
      box.style.display = 'flex';
      box.style.alignItems = 'center';
      box.style.justifyContent = 'center';
      box.style.color = 'white';
      box.style.fontSize = '12px';
      box.style.fontWeight = 'bold';
      box.style.textShadow = '0 0 2px black';

      if (text) {
        const span = document.createElement('span');
        span.innerText = text;
        span.style.pointerEvents = 'none';
        box.appendChild(span);
      }

      const createHandle = (cursor: string, styles: any) => {
        const h = document.createElement('div');
        h.style.position = 'absolute';
        h.style.width = '10px';
        h.style.height = '10px';
        h.style.backgroundColor = '#1e222d';
        h.style.border = `1px solid ${baseColor}`;
        h.style.cursor = cursor;
        h.style.zIndex = '10';
        h.style.touchAction = 'none';
        Object.assign(h.style, styles);
        return h;
      };

      const tl = createHandle('nwse-resize', { top: '-5px', left: '-5px' });
      const tr = createHandle('nesw-resize', { top: '-5px', right: '-5px' });
      const bl = createHandle('nesw-resize', { bottom: '-5px', left: '-5px' });
      const br = createHandle('nwse-resize', { bottom: '-5px', right: '-5px' });

      box.appendChild(tl);
      box.appendChild(tr);
      box.appendChild(bl);
      box.appendChild(br);

      container.appendChild(box);
      boxesRef.current.push(box);

      drawingsStateRef.current.push({
        getState: () => ({
          type: 'box',
          color,
          text,
          logical1: logicalStart,
          logical2: logicalEnd,
          price1: priceTop,
          price2: priceBottom
        })
      });

      // Function to update box position based on chart coordinates
      const updateBoxPosition = () => {
        const topY = series.priceToCoordinate(priceTop);
        const bottomY = series.priceToCoordinate(priceBottom);

        let leftX = 0;
        let rightX = chart.timeScale().width();

        if (logicalStart !== null) {
          const x = chart.timeScale().logicalToCoordinate(logicalStart);
          if (x !== null) leftX = x;
        }
        if (logicalEnd !== null) {
          const x = chart.timeScale().logicalToCoordinate(logicalEnd);
          if (x !== null) rightX = x;
        }

        if (topY !== null && bottomY !== null) {
          const y = Math.min(topY, bottomY);
          const height = Math.abs(bottomY - topY);
          const width = Math.abs(rightX - leftX);
          const actualLeft = Math.min(leftX, rightX);

          box.style.top = `${y}px`;
          box.style.height = `${height}px`;
          box.style.left = `${actualLeft}px`;
          box.style.width = `${width}px`;
        }
      };

      // Initial update
      updateBoxPosition();

      // Update on chart scroll/zoom
      chart.timeScale().subscribeVisibleTimeRangeChange(updateBoxPosition);
      chart.timeScale().subscribeSizeChange(updateBoxPosition);

      const makeDraggable = (element: HTMLElement, type: 'box' | 'tl' | 'tr' | 'bl' | 'br') => {
        element.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          const rect = container.getBoundingClientRect();

          const startChartX = e.clientX - rect.left;
          const startChartY = e.clientY - rect.top;

          const startLogical = chart.timeScale().coordinateToLogical(startChartX);
          const startPrice = series.coordinateToPrice(startChartY);

          const initialLS = logicalStart;
          const initialLE = logicalEnd;
          const initialPT = priceTop;
          const initialPB = priceBottom;

          const onPointerMove = (moveEvent: PointerEvent) => {
            const currentChartX = moveEvent.clientX - rect.left;
            const currentChartY = moveEvent.clientY - rect.top;

            const currentLogical = chart.timeScale().coordinateToLogical(currentChartX);
            const currentPrice = series.coordinateToPrice(currentChartY);

            if (currentLogical !== null && startLogical !== null && currentPrice !== null && startPrice !== null) {
              const logicalDelta = currentLogical - startLogical;
              const priceDelta = currentPrice - startPrice;

              if (type === 'box') {
                if (initialLS !== null) logicalStart = initialLS + logicalDelta;
                if (initialLE !== null) logicalEnd = initialLE + logicalDelta;
                priceTop = initialPT + priceDelta;
                priceBottom = initialPB + priceDelta;
              } else {
                if (type === 'tl' || type === 'bl') {
                  if (initialLS !== null) logicalStart = initialLS + logicalDelta;
                }
                if (type === 'tr' || type === 'br') {
                  if (initialLE !== null) logicalEnd = initialLE + logicalDelta;
                }
                if (type === 'tl' || type === 'tr') {
                  priceTop = initialPT + priceDelta;
                }
                if (type === 'bl' || type === 'br') {
                  priceBottom = initialPB + priceDelta;
                }
              }
              updateBoxPosition();
            }
          };

          const onPointerUp = () => {
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
          };

          document.addEventListener('pointermove', onPointerMove);
          document.addEventListener('pointerup', onPointerUp);
        });
      };

      makeDraggable(box, 'box');
      makeDraggable(tl, 'tl');
      makeDraggable(tr, 'tr');
      makeDraggable(bl, 'bl');
      makeDraggable(br, 'br');

      box.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (selectedDrawingRef.current) {
          selectedDrawingRef.current.element.style.outline = 'none';
        }
        box.style.outline = '2px solid white';
        selectedDrawingRef.current = {
          element: box,
          remove: () => {
            box.remove();
            boxesRef.current = boxesRef.current.filter(b => b !== box);
          }
        };
      });
    },
    addTrendLine: (p1: { time: number, price: number }, p2: { time: number, price: number }, color: string, lineWidth: number = 2, lineStyle: number = 0, text?: string) => {
      if (!chartRef.current || !seriesRef.current || !svgContainerRef.current || !chartContainerRef.current) return;
      const chart = chartRef.current;
      const series = seriesRef.current;
      const container = chartContainerRef.current;

      let logical1 = (chart.timeScale() as any).timeToLogical(p1.time as Time);
      let logical2 = (chart.timeScale() as any).timeToLogical(p2.time as Time);
      let price1 = p1.price;
      let price2 = p2.price;

      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');

      const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      hitLine.setAttribute('stroke', 'transparent');
      hitLine.setAttribute('stroke-width', '15');
      hitLine.style.cursor = 'move';
      hitLine.style.pointerEvents = 'auto';
      hitLine.style.touchAction = 'none';

      const visibleLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      visibleLine.setAttribute('stroke', color);
      visibleLine.setAttribute('stroke-width', lineWidth.toString());
      if (lineStyle === 1) {
        visibleLine.setAttribute('stroke-dasharray', '2,4');
      } else if (lineStyle === 2) {
        visibleLine.setAttribute('stroke-dasharray', '8,8');
      }
      visibleLine.style.pointerEvents = 'none';

      let textElement: SVGTextElement | null = null;
      if (text) {
        textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textElement.setAttribute('fill', color);
        textElement.setAttribute('font-size', '12');
        textElement.setAttribute('font-family', 'sans-serif');
        textElement.setAttribute('text-anchor', 'middle');
        textElement.setAttribute('dominant-baseline', 'bottom');
        textElement.style.pointerEvents = 'none';
        textElement.textContent = text;
        group.appendChild(textElement);
      }

      const createHandle = () => {
        const h = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        h.setAttribute('r', '5');
        h.setAttribute('fill', '#1e222d');
        h.setAttribute('stroke', color);
        h.setAttribute('stroke-width', '2');
        h.style.cursor = 'pointer';
        h.style.pointerEvents = 'auto';
        h.style.touchAction = 'none';
        return h;
      };

      const handle1 = createHandle();
      const handle2 = createHandle();

      group.appendChild(hitLine);
      group.appendChild(visibleLine);
      group.appendChild(handle1);
      group.appendChild(handle2);
      svgContainerRef.current.appendChild(group);

      drawingsStateRef.current.push({
        getState: () => ({
          type: 'trendLine',
          color,
          lineWidth,
          lineStyle,
          text,
          logical1,
          logical2,
          price1,
          price2
        })
      });

      const updatePosition = () => {
        if (logical1 === null || logical2 === null) return;
        const x1 = chart.timeScale().logicalToCoordinate(logical1);
        const x2 = chart.timeScale().logicalToCoordinate(logical2);
        const y1 = series.priceToCoordinate(price1);
        const y2 = series.priceToCoordinate(price2);

        if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
          hitLine.setAttribute('x1', x1.toString());
          hitLine.setAttribute('y1', y1.toString());
          hitLine.setAttribute('x2', x2.toString());
          hitLine.setAttribute('y2', y2.toString());

          visibleLine.setAttribute('x1', x1.toString());
          visibleLine.setAttribute('y1', y1.toString());
          visibleLine.setAttribute('x2', x2.toString());
          visibleLine.setAttribute('y2', y2.toString());

          handle1.setAttribute('cx', x1.toString());
          handle1.setAttribute('cy', y1.toString());

          handle2.setAttribute('cx', x2.toString());
          handle2.setAttribute('cy', y2.toString());

          if (textElement) {
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2 - 10;
            textElement.setAttribute('x', midX.toString());
            textElement.setAttribute('y', midY.toString());

            const dx = x2 - x1;
            const dy = y2 - y1;
            let angle = Math.atan2(dy, dx) * (180 / Math.PI);
            if (angle > 90 || angle < -90) {
              angle += 180;
            }
            textElement.setAttribute('transform', `rotate(${angle} ${midX} ${midY})`);
          }
        }
      };

      updatePosition();
      chart.timeScale().subscribeVisibleTimeRangeChange(updatePosition);
      chart.timeScale().subscribeSizeChange(updatePosition);

      const makeDraggable = (element: SVGElement, type: 'line' | 'h1' | 'h2') => {
        element.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          const rect = container.getBoundingClientRect();

          const startChartX = e.clientX - rect.left;
          const startChartY = e.clientY - rect.top;

          const startLogical = chart.timeScale().coordinateToLogical(startChartX);
          const startPrice = series.coordinateToPrice(startChartY);

          const initialL1 = logical1;
          const initialL2 = logical2;
          const initialP1 = price1;
          const initialP2 = price2;

          const onPointerMove = (moveEvent: PointerEvent) => {
            const currentChartX = moveEvent.clientX - rect.left;
            const currentChartY = moveEvent.clientY - rect.top;

            const currentLogical = chart.timeScale().coordinateToLogical(currentChartX);
            const currentPrice = series.coordinateToPrice(currentChartY);

            if (currentLogical !== null && startLogical !== null && currentPrice !== null && startPrice !== null) {
              const logicalDelta = currentLogical - startLogical;
              const priceDelta = currentPrice - startPrice;

              if (type === 'line') {
                if (initialL1 !== null) logical1 = initialL1 + logicalDelta;
                if (initialL2 !== null) logical2 = initialL2 + logicalDelta;
                price1 = initialP1 + priceDelta;
                price2 = initialP2 + priceDelta;
              } else if (type === 'h1') {
                if (initialL1 !== null) logical1 = initialL1 + logicalDelta;
                price1 = initialP1 + priceDelta;
              } else if (type === 'h2') {
                if (initialL2 !== null) logical2 = initialL2 + logicalDelta;
                price2 = initialP2 + priceDelta;
              }
              updatePosition();
            }
          };

          const onPointerUp = () => {
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
          };

          document.addEventListener('pointermove', onPointerMove);
          document.addEventListener('pointerup', onPointerUp);
        });
      };

      makeDraggable(hitLine, 'line');
      makeDraggable(handle1, 'h1');
      makeDraggable(handle2, 'h2');

      hitLine.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (selectedDrawingRef.current) {
          selectedDrawingRef.current.element.style.outline = 'none';
          if (selectedDrawingRef.current.element instanceof SVGElement) {
            selectedDrawingRef.current.element.style.filter = 'none';
          }
        }
        group.style.filter = 'drop-shadow(0px 0px 2px white)';
        selectedDrawingRef.current = {
          element: group,
          remove: () => {
            group.remove();
          }
        };
      });
    },
    addVerticalLine: (time: number, color: string, lineWidth: number = 2, lineStyle: number = 0) => {
      if (!chartRef.current || !seriesRef.current || !svgContainerRef.current || !chartContainerRef.current) return;
      const chart = chartRef.current;

      let logical = (chart.timeScale() as any).timeToLogical(time as Time);

      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');

      const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      hitLine.setAttribute('stroke', 'transparent');
      hitLine.setAttribute('stroke-width', '15');
      hitLine.style.cursor = 'ew-resize';
      hitLine.style.pointerEvents = 'auto';
      hitLine.style.touchAction = 'none';

      const visibleLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      visibleLine.setAttribute('stroke', color);
      visibleLine.setAttribute('stroke-width', lineWidth.toString());
      if (lineStyle === 1) {
        visibleLine.setAttribute('stroke-dasharray', '2,4');
      } else if (lineStyle === 2) {
        visibleLine.setAttribute('stroke-dasharray', '8,8');
      }
      visibleLine.style.pointerEvents = 'none';

      group.appendChild(hitLine);
      group.appendChild(visibleLine);
      svgContainerRef.current.appendChild(group);
      linesRef.current.push(group);

      drawingsStateRef.current.push({
        getState: () => ({
          type: 'verticalLine',
          color,
          lineWidth,
          lineStyle,
          logical1: logical
        })
      });

      const updatePosition = () => {
        if (logical === null) return;
        const x = chart.timeScale().logicalToCoordinate(logical);
        const height = chartContainerRef.current!.clientHeight;

        if (x !== null) {
          hitLine.setAttribute('x1', x.toString());
          hitLine.setAttribute('y1', '0');
          hitLine.setAttribute('x2', x.toString());
          hitLine.setAttribute('y2', height.toString());

          visibleLine.setAttribute('x1', x.toString());
          visibleLine.setAttribute('y1', '0');
          visibleLine.setAttribute('x2', x.toString());
          visibleLine.setAttribute('y2', height.toString());
        }
      };

      updatePosition();
      chart.timeScale().subscribeVisibleTimeRangeChange(updatePosition);
      chart.timeScale().subscribeSizeChange(updatePosition);

      let isDragging = false;
      let startChartX = 0;
      let startLogical: number | null = null;

      hitLine.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const rect = chartContainerRef.current!.getBoundingClientRect();
        startChartX = e.clientX - rect.left;
        startLogical = chart.timeScale().coordinateToLogical(startChartX);
        isDragging = true;

        const onPointerMove = (moveEvent: PointerEvent) => {
          if (!isDragging) return;
          const currentChartX = moveEvent.clientX - rect.left;
          const currentLogical = chart.timeScale().coordinateToLogical(currentChartX);

          if (startLogical !== null && currentLogical !== null) {
            const logicalDelta = currentLogical - startLogical;
            logical! += logicalDelta;
            startLogical = currentLogical;
            updatePosition();
          }
        };

        const onPointerUp = () => {
          isDragging = false;
          document.removeEventListener('pointermove', onPointerMove);
          document.removeEventListener('pointerup', onPointerUp);
        };

        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);

        if (selectedDrawingRef.current) {
          selectedDrawingRef.current.element.style.outline = 'none';
          if (selectedDrawingRef.current.element instanceof SVGElement) {
            selectedDrawingRef.current.element.style.filter = 'none';
          }
        }
        group.style.filter = 'drop-shadow(0px 0px 2px white)';
        selectedDrawingRef.current = {
          element: group,
          remove: () => {
            group.remove();
          }
        };
      });
    },
    addText: (time: number, price: number, text: string, color: string) => {
      if (!chartRef.current || !seriesRef.current || !svgContainerRef.current || !chartContainerRef.current) return;
      const chart = chartRef.current;
      const series = seriesRef.current;

      let logical = (chart.timeScale() as any).timeToLogical(time as Time);
      let p = price;

      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');

      const textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      textElement.setAttribute('fill', color);
      textElement.setAttribute('font-size', '14');
      textElement.setAttribute('font-family', 'sans-serif');
      textElement.setAttribute('text-anchor', 'middle');
      textElement.setAttribute('dominant-baseline', 'middle');
      textElement.style.cursor = 'move';
      textElement.style.pointerEvents = 'auto';
      textElement.style.touchAction = 'none';
      textElement.textContent = text;

      group.appendChild(textElement);
      svgContainerRef.current.appendChild(group);
      linesRef.current.push(group);

      drawingsStateRef.current.push({
        getState: () => ({
          type: 'text',
          color,
          text,
          logical1: logical,
          price1: p
        })
      });

      const updatePosition = () => {
        if (logical === null) return;
        const x = chart.timeScale().logicalToCoordinate(logical);
        const y = series.priceToCoordinate(p);

        if (x !== null && y !== null) {
          textElement.setAttribute('x', x.toString());
          textElement.setAttribute('y', y.toString());
        }
      };

      updatePosition();
      chart.timeScale().subscribeVisibleTimeRangeChange(updatePosition);
      chart.timeScale().subscribeSizeChange(updatePosition);

      let isDragging = false;
      let startChartX = 0;
      let startChartY = 0;
      let startLogical: number | null = null;
      let startPrice = 0;

      textElement.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const rect = chartContainerRef.current!.getBoundingClientRect();
        startChartX = e.clientX - rect.left;
        startChartY = e.clientY - rect.top;
        startLogical = chart.timeScale().coordinateToLogical(startChartX);
        startPrice = series.coordinateToPrice(startChartY) || 0;
        isDragging = true;

        const onPointerMove = (moveEvent: PointerEvent) => {
          if (!isDragging) return;
          const currentChartX = moveEvent.clientX - rect.left;
          const currentChartY = moveEvent.clientY - rect.top;
          const currentLogical = chart.timeScale().coordinateToLogical(currentChartX);
          const currentP = series.coordinateToPrice(currentChartY);

          if (startLogical !== null && currentLogical !== null && currentP !== null) {
            const logicalDelta = currentLogical - startLogical;
            const priceDelta = currentP - startPrice;
            logical += logicalDelta;
            p += priceDelta;
            startLogical = currentLogical;
            startPrice = currentP;
            updatePosition();
          }
        };

        const onPointerUp = () => {
          isDragging = false;
          document.removeEventListener('pointermove', onPointerMove);
          document.removeEventListener('pointerup', onPointerUp);
        };

        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);

        if (selectedDrawingRef.current) {
          selectedDrawingRef.current.element.style.outline = 'none';
          if (selectedDrawingRef.current.element instanceof SVGElement) {
            selectedDrawingRef.current.element.style.filter = 'none';
          }
        }
        group.style.filter = 'drop-shadow(0px 0px 2px white)';
        selectedDrawingRef.current = {
          element: group,
          remove: () => {
            group.remove();
          }
        };
      });
    },
    addFibonacci: (p1: { time: number, price: number }, p2: { time: number, price: number }, color: string, lineWidth: number = 1, lineStyle: number = 0) => {
      if (!chartRef.current || !seriesRef.current || !svgContainerRef.current || !chartContainerRef.current) return;
      const chart = chartRef.current;
      const series = seriesRef.current;

      let logical1 = (chart.timeScale() as any).timeToLogical(p1.time as Time);
      let logical2 = (chart.timeScale() as any).timeToLogical(p2.time as Time);
      let price1 = p1.price;
      let price2 = p2.price;

      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');

      const trendLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      trendLine.setAttribute('stroke', color);
      trendLine.setAttribute('stroke-width', lineWidth.toString());
      trendLine.setAttribute('stroke-dasharray', '4,4');
      trendLine.style.pointerEvents = 'none';
      group.appendChild(trendLine);

      const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      hitLine.setAttribute('stroke', 'transparent');
      hitLine.setAttribute('stroke-width', '15');
      hitLine.style.cursor = 'move';
      hitLine.style.pointerEvents = 'auto';
      hitLine.style.touchAction = 'none';
      group.appendChild(hitLine);

      const fibLevels = [
        { ratio: 0, color: '#787B86' },
        { ratio: 0.236, color: '#F44336' },
        { ratio: 0.382, color: '#81C784' },
        { ratio: 0.5, color: '#4CAF50' },
        { ratio: 0.618, color: '#009688' },
        { ratio: 0.786, color: '#64B5F6' },
        { ratio: 1, color: '#787B86' },
      ];

      const levelLines: SVGLineElement[] = [];
      const levelTexts: SVGTextElement[] = [];

      fibLevels.forEach(level => {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        const levelColor = color !== '#2962FF' ? color : level.color;
        line.setAttribute('stroke', levelColor);
        line.setAttribute('stroke-width', lineWidth.toString());
        if (lineStyle === 1) line.setAttribute('stroke-dasharray', '2,4');
        if (lineStyle === 2) line.setAttribute('stroke-dasharray', '8,8');
        line.style.pointerEvents = 'none';
        levelLines.push(line);
        group.appendChild(line);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('fill', levelColor);
        text.setAttribute('font-size', '12');
        text.setAttribute('font-family', 'sans-serif');
        text.setAttribute('dominant-baseline', 'bottom');
        text.style.pointerEvents = 'none';
        text.textContent = `${level.ratio}`;
        levelTexts.push(text);
        group.appendChild(text);
      });

      const createHandle = () => {
        const h = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        h.setAttribute('r', '5');
        h.setAttribute('fill', '#1e222d');
        h.setAttribute('stroke', color);
        h.setAttribute('stroke-width', '2');
        h.style.cursor = 'pointer';
        h.style.pointerEvents = 'auto';
        h.style.touchAction = 'none';
        return h;
      };

      const handle1 = createHandle();
      const handle2 = createHandle();
      group.appendChild(handle1);
      group.appendChild(handle2);

      svgContainerRef.current.appendChild(group);
      linesRef.current.push(group);

      const updatePosition = () => {
        if (logical1 === null || logical2 === null) return;
        const x1 = chart.timeScale().logicalToCoordinate(logical1);
        const x2 = chart.timeScale().logicalToCoordinate(logical2);
        const y1 = series.priceToCoordinate(price1);
        const y2 = series.priceToCoordinate(price2);

        if (x1 !== null && x2 !== null && y1 !== null && y2 !== null) {
          trendLine.setAttribute('x1', x1.toString());
          trendLine.setAttribute('y1', y1.toString());
          trendLine.setAttribute('x2', x2.toString());
          trendLine.setAttribute('y2', y2.toString());

          hitLine.setAttribute('x1', x1.toString());
          hitLine.setAttribute('y1', y1.toString());
          hitLine.setAttribute('x2', x2.toString());
          hitLine.setAttribute('y2', y2.toString());

          handle1.setAttribute('cx', x1.toString());
          handle1.setAttribute('cy', y1.toString());
          handle2.setAttribute('cx', x2.toString());
          handle2.setAttribute('cy', y2.toString());

          const diff = price1 - price2;
          const startX = Math.min(x1, x2);
          const endX = Math.max(x1, x2) + 200; // Extend to the right

          fibLevels.forEach((level, i) => {
            const levelPrice = price1 - diff * level.ratio;
            const levelY = series.priceToCoordinate(levelPrice);
            if (levelY !== null) {
              levelLines[i].setAttribute('x1', startX.toString());
              levelLines[i].setAttribute('y1', levelY.toString());
              levelLines[i].setAttribute('x2', endX.toString());
              levelLines[i].setAttribute('y2', levelY.toString());

              levelTexts[i].setAttribute('x', startX.toString());
              levelTexts[i].setAttribute('y', (levelY - 4).toString());
            }
          });
        }
      };

      updatePosition();
      chart.timeScale().subscribeVisibleTimeRangeChange(updatePosition);
      chart.timeScale().subscribeSizeChange(updatePosition);

      const makeDraggable = (element: SVGElement, type: 'line' | 'h1' | 'h2') => {
        element.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          const rect = chartContainerRef.current!.getBoundingClientRect();
          const startChartX = e.clientX - rect.left;
          const startChartY = e.clientY - rect.top;

          const startLogical = chart.timeScale().coordinateToLogical(startChartX);
          const startPrice = series.coordinateToPrice(startChartY);

          const initialL1 = logical1;
          const initialL2 = logical2;
          const initialP1 = price1;
          const initialP2 = price2;

          const onPointerMove = (moveEvent: PointerEvent) => {
            const currentChartX = moveEvent.clientX - rect.left;
            const currentChartY = moveEvent.clientY - rect.top;

            const currentLogical = chart.timeScale().coordinateToLogical(currentChartX);
            const currentPrice = series.coordinateToPrice(currentChartY);

            if (currentLogical !== null && startLogical !== null && currentPrice !== null && startPrice !== null) {
              const logicalDelta = currentLogical - startLogical;
              const priceDelta = currentPrice - startPrice;

              if (type === 'line') {
                if (initialL1 !== null) logical1 = initialL1 + logicalDelta;
                if (initialL2 !== null) logical2 = initialL2 + logicalDelta;
                price1 = initialP1 + priceDelta;
                price2 = initialP2 + priceDelta;
              } else if (type === 'h1') {
                if (initialL1 !== null) logical1 = initialL1 + logicalDelta;
                price1 = initialP1 + priceDelta;
              } else if (type === 'h2') {
                if (initialL2 !== null) logical2 = initialL2 + logicalDelta;
                price2 = initialP2 + priceDelta;
              }
              updatePosition();
            }
          };

          const onPointerUp = () => {
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
          };

          document.addEventListener('pointermove', onPointerMove);
          document.addEventListener('pointerup', onPointerUp);

          if (selectedDrawingRef.current) {
            selectedDrawingRef.current.element.style.outline = 'none';
            if (selectedDrawingRef.current.element instanceof SVGElement) {
              selectedDrawingRef.current.element.style.filter = 'none';
            }
          }
          group.style.filter = 'drop-shadow(0px 0px 2px white)';
          selectedDrawingRef.current = {
            element: group,
            remove: () => {
              group.remove();
            }
          };
        });
      };

      makeDraggable(hitLine, 'line');
      makeDraggable(handle1, 'h1');
      makeDraggable(handle2, 'h2');
    },
  }));

  const onChartClickRef = useRef(onChartClick);
  useEffect(() => {
    onChartClickRef.current = onChartClick;
  }, [onChartClick]);

  const drawingPointsRef = useRef(drawingPoints);
  const drawingConfigRef = useRef(drawingConfig);
  const activeToolRef = useRef(activeTool);

  useEffect(() => {
    drawingPointsRef.current = drawingPoints;
    drawingConfigRef.current = drawingConfig;
    activeToolRef.current = activeTool;

    if (!drawingPoints || drawingPoints.length === 0) {
      if (previewLineRef.current) previewLineRef.current.style.display = 'none';
      if (previewBoxRef.current) previewBoxRef.current.style.display = 'none';
    }
  }, [drawingPoints, drawingConfig, activeTool]);

  useEffect(() => {
    if (chartRef.current) {
      const isDrawing = activeTool && !['Crosshair', 'Cursor', 'Zoom In', 'Zoom Out', 'Pan Left', 'Pan Right'].includes(activeTool);
      chartRef.current.applyOptions({
        handleScroll: !isDrawing,
        handleScale: !isDrawing,
      });
    }
  }, [activeTool]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#0A0E17' },
        textColor: '#A0AEC0',
      },
      grid: {
        vertLines: { color: '#1A202C' },
        horzLines: { color: '#1A202C' },
      },
      crosshair: {
        mode: 0,
        vertLine: {
          color: '#00E676',
          width: 1,
          style: 3,
          labelBackgroundColor: '#00E676',
        },
        horzLine: {
          color: '#00E676',
          width: 1,
          style: 3,
          labelBackgroundColor: '#00E676',
        },
      },
      timeScale: {
        borderColor: '#1A202C',
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: '#1A202C',
      },
    });

    const svgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgContainer.style.position = 'absolute';
    svgContainer.style.top = '0';
    svgContainer.style.left = '0';
    svgContainer.style.width = '100%';
    svgContainer.style.height = '100%';
    svgContainer.style.pointerEvents = 'none';
    svgContainer.style.zIndex = '4';
    chartContainerRef.current.appendChild(svgContainer);
    svgContainerRef.current = svgContainer;

    const defaultColors = {
      upColor: '#00E676',
      downColor: '#FF1744',
      borderVisible: false,
      wickVisible: true,
    };
    const currentColors = colors || defaultColors;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: currentColors.upColor,
      downColor: currentColors.downColor,
      borderVisible: currentColors.borderVisible,
      wickVisible: currentColors.wickVisible,
      wickUpColor: currentColors.upColor,
      wickDownColor: currentColors.downColor,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: 'rgba(0, 230, 118, 0.3)',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '', // set as an overlay by setting a blank priceScaleId
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8, // highest point of the series will be at 80% of the chart height
        bottom: 0,
      },
    });

    const indicatorSeries: Record<string, any> = {};

    activeIndicators.forEach(indicator => {
      if (indicator === 'SMA 20') {
        indicatorSeries['SMA 20'] = chart.addSeries(LineSeries, { color: '#2962FF', lineWidth: 2, crosshairMarkerVisible: false });
      } else if (indicator === 'SMA 50') {
        indicatorSeries['SMA 50'] = chart.addSeries(LineSeries, { color: '#FF6D00', lineWidth: 2, crosshairMarkerVisible: false });
      } else if (indicator === 'SMA 200') {
        indicatorSeries['SMA 200'] = chart.addSeries(LineSeries, { color: '#9C27B0', lineWidth: 2, crosshairMarkerVisible: false });
      } else if (indicator === 'EMA 20') {
        indicatorSeries['EMA 20'] = chart.addSeries(LineSeries, { color: '#00E676', lineWidth: 2, crosshairMarkerVisible: false });
      } else if (indicator === 'EMA 50') {
        indicatorSeries['EMA 50'] = chart.addSeries(LineSeries, { color: '#FF1744', lineWidth: 2, crosshairMarkerVisible: false });
      } else if (indicator === 'RSI') {
        indicatorSeries['RSI'] = chart.addSeries(LineSeries, { color: '#E040FB', lineWidth: 2, priceScaleId: 'left' });
      } else if (indicator === 'MACD') {
        indicatorSeries['MACD_Line'] = chart.addSeries(LineSeries, { color: '#2962FF', lineWidth: 2, priceScaleId: 'left' });
        indicatorSeries['MACD_Signal'] = chart.addSeries(LineSeries, { color: '#FF6D00', lineWidth: 2, priceScaleId: 'left' });
        indicatorSeries['MACD_Hist'] = chart.addSeries(HistogramSeries, { color: 'rgba(0, 230, 118, 0.3)', priceScaleId: 'left' });
      }
    });

    // Legend
    const legend = document.createElement('div');
    legend.className = 'absolute top-14 left-4 z-10 text-xs font-mono flex flex-col gap-1 pointer-events-none bg-gray-900/50 p-2 rounded';
    legend.style.pointerEvents = 'none';
    chartContainerRef.current.appendChild(legend);

    // Floating Tooltip
    const toolTipWidth = 120;
    const toolTipHeight = 140;
    const toolTipMargin = 15;

    const toolTip = document.createElement('div');
    toolTip.className = 'absolute z-50 bg-[#111827]/90 backdrop-blur-md border border-[#374151] text-gray-200 text-xs rounded-xl p-3 pointer-events-none shadow-2xl font-mono flex-col gap-1';
    toolTip.style.display = 'none';
    toolTip.style.pointerEvents = 'none';
    chartContainerRef.current.appendChild(toolTip);

    chart.subscribeClick((param) => {
      if (selectedDrawingRef.current) {
        selectedDrawingRef.current.element.style.outline = 'none';
        if (selectedDrawingRef.current.element instanceof SVGElement) {
          selectedDrawingRef.current.element.style.filter = 'none';
        }
        selectedDrawingRef.current = null;
      }
      if (param.time && param.point) {
        const price = candlestickSeries.coordinateToPrice(param.point.y);
        if (price !== null && onChartClickRef.current) {
          onChartClickRef.current(param.time as number, price);
        }
      }
    });

    chart.subscribeCrosshairMove((param) => {
      if (!chartContainerRef.current) return;

      if (
        param.point === undefined ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > chartContainerRef.current.clientWidth ||
        param.point.y < 0 ||
        param.point.y > chartContainerRef.current.clientHeight
      ) {
        legend.innerHTML = '';
        toolTip.style.display = 'none';
      } else {
        const candleData = param.seriesData.get(candlestickSeries) as any;
        const vol = param.seriesData.get(volumeSeries) as any;

        const indicatorValues: Record<string, any> = {};
        Object.entries(indicatorSeries).forEach(([key, series]) => {
          indicatorValues[key] = param.seriesData.get(series) as any;
        });

        if (candleData && candleData.open !== undefined) {
          const isUp = candleData.close >= candleData.open;
          const upColorHex = currentColors.upColor;
          const downColorHex = currentColors.downColor;
          const colorStyle = isUp ? `color: ${upColorHex}` : `color: ${downColorHex}`;

          let indicatorsHtml = '';
          if (indicatorValues['SMA 20'] && indicatorValues['SMA 20'].value !== undefined) indicatorsHtml += `<span class="text-[#2962FF]">SMA 20 <span class="text-gray-200">${indicatorValues['SMA 20'].value.toFixed(2)}</span></span>`;
          if (indicatorValues['SMA 50'] && indicatorValues['SMA 50'].value !== undefined) indicatorsHtml += `<span class="text-[#FF6D00]">SMA 50 <span class="text-gray-200">${indicatorValues['SMA 50'].value.toFixed(2)}</span></span>`;
          if (indicatorValues['SMA 200'] && indicatorValues['SMA 200'].value !== undefined) indicatorsHtml += `<span class="text-[#9C27B0]">SMA 200 <span class="text-gray-200">${indicatorValues['SMA 200'].value.toFixed(2)}</span></span>`;
          if (indicatorValues['EMA 20'] && indicatorValues['EMA 20'].value !== undefined) indicatorsHtml += `<span class="text-[#00E676]">EMA 20 <span class="text-gray-200">${indicatorValues['EMA 20'].value.toFixed(2)}</span></span>`;
          if (indicatorValues['EMA 50'] && indicatorValues['EMA 50'].value !== undefined) indicatorsHtml += `<span class="text-[#FF1744]">EMA 50 <span class="text-gray-200">${indicatorValues['EMA 50'].value.toFixed(2)}</span></span>`;
          if (indicatorValues['RSI'] && indicatorValues['RSI'].value !== undefined) indicatorsHtml += `<span class="text-[#E040FB]">RSI <span class="text-gray-200">${indicatorValues['RSI'].value.toFixed(2)}</span></span>`;
          if (indicatorValues['MACD_Line'] && indicatorValues['MACD_Line'].value !== undefined) indicatorsHtml += `<span class="text-[#2962FF]">MACD <span class="text-gray-200">${indicatorValues['MACD_Line'].value.toFixed(2)}</span></span>`;

          legend.innerHTML = `
            <div class="flex gap-3 text-gray-300">
              <span>O <span style="${colorStyle}">${candleData.open.toFixed(2)}</span></span>
              <span>H <span style="${colorStyle}">${candleData.high.toFixed(2)}</span></span>
              <span>L <span style="${colorStyle}">${candleData.low.toFixed(2)}</span></span>
              <span>C <span style="${colorStyle}">${candleData.close.toFixed(2)}</span></span>
            </div>
            <div class="flex gap-3 mt-1 flex-wrap">
              ${vol && vol.value !== undefined ? `<span class="text-gray-400">Vol <span class="text-gray-200">${(vol.value / 1000).toFixed(1)}K</span></span>` : ''}
              ${indicatorsHtml}
            </div>
          `;

          let tooltipIndicatorsHtml = '';
          if (indicatorValues['SMA 20'] && indicatorValues['SMA 20'].value !== undefined) tooltipIndicatorsHtml += `<div class="flex justify-between gap-4"><span class="text-[#2962FF]">SMA 20:</span> <span>${indicatorValues['SMA 20'].value.toFixed(2)}</span></div>`;
          if (indicatorValues['SMA 50'] && indicatorValues['SMA 50'].value !== undefined) tooltipIndicatorsHtml += `<div class="flex justify-between gap-4"><span class="text-[#FF6D00]">SMA 50:</span> <span>${indicatorValues['SMA 50'].value.toFixed(2)}</span></div>`;
          if (indicatorValues['SMA 200'] && indicatorValues['SMA 200'].value !== undefined) tooltipIndicatorsHtml += `<div class="flex justify-between gap-4"><span class="text-[#9C27B0]">SMA 200:</span> <span>${indicatorValues['SMA 200'].value.toFixed(2)}</span></div>`;
          if (indicatorValues['EMA 20'] && indicatorValues['EMA 20'].value !== undefined) tooltipIndicatorsHtml += `<div class="flex justify-between gap-4"><span class="text-[#00E676]">EMA 20:</span> <span>${indicatorValues['EMA 20'].value.toFixed(2)}</span></div>`;
          if (indicatorValues['EMA 50'] && indicatorValues['EMA 50'].value !== undefined) tooltipIndicatorsHtml += `<div class="flex justify-between gap-4"><span class="text-[#FF1744]">EMA 50:</span> <span>${indicatorValues['EMA 50'].value.toFixed(2)}</span></div>`;
          if (indicatorValues['RSI'] && indicatorValues['RSI'].value !== undefined) tooltipIndicatorsHtml += `<div class="flex justify-between gap-4"><span class="text-[#E040FB]">RSI:</span> <span>${indicatorValues['RSI'].value.toFixed(2)}</span></div>`;
          if (indicatorValues['MACD_Line'] && indicatorValues['MACD_Line'].value !== undefined) tooltipIndicatorsHtml += `<div class="flex justify-between gap-4"><span class="text-[#2962FF]">MACD:</span> <span>${indicatorValues['MACD_Line'].value.toFixed(2)}</span></div>`;

          // Update floating tooltip
          toolTip.style.display = 'flex';
          const dateStr = new Date((param.time as number) * 1000).toLocaleString();
          toolTip.innerHTML = `
            <div class="font-semibold text-gray-300 mb-1.5 border-b border-[#374151] pb-1.5">${dateStr}</div>
            <div class="flex flex-col gap-1">
              <div class="flex justify-between gap-6"><span class="text-gray-400">Open</span> <span style="${colorStyle} font-weight: 500;">${candleData.open.toFixed(2)}</span></div>
              <div class="flex justify-between gap-6"><span class="text-gray-400">High</span> <span style="${colorStyle} font-weight: 500;">${candleData.high.toFixed(2)}</span></div>
              <div class="flex justify-between gap-6"><span class="text-gray-400">Low</span> <span style="${colorStyle} font-weight: 500;">${candleData.low.toFixed(2)}</span></div>
              <div class="flex justify-between gap-6"><span class="text-gray-400">Close</span> <span style="${colorStyle} font-weight: 500;">${candleData.close.toFixed(2)}</span></div>
            </div>
            ${vol && vol.value !== undefined ? `<div class="flex justify-between gap-6 mt-1.5 border-t border-[#374151] pt-1.5"><span class="text-gray-400">Volume</span> <span class="font-medium text-gray-200">${(vol.value / 1000).toFixed(1)}K</span></div>` : ''}
            ${tooltipIndicatorsHtml ? `<div class="mt-1.5 border-t border-[#374151] pt-1.5 flex flex-col gap-1">${tooltipIndicatorsHtml}</div>` : ''}
          `;

          // Position tooltip near the mouse cursor
          const x = param.point.x;
          const y = param.point.y;

          // Calculate tooltip dimensions (approximate if not rendered yet)
          const tooltipRect = toolTip.getBoundingClientRect();
          const actualWidth = tooltipRect.width || toolTipWidth;
          const actualHeight = tooltipRect.height || toolTipHeight;

          let left = x + toolTipMargin;
          let top = y + toolTipMargin;

          // Adjust if it goes off-screen right
          if (left + actualWidth > chartContainerRef.current.clientWidth) {
            left = x - actualWidth - toolTipMargin;
          }

          // Adjust if it goes off-screen bottom
          if (top + actualHeight > chartContainerRef.current.clientHeight) {
            top = y - actualHeight - toolTipMargin;
          }

          // Ensure it doesn't go off-screen top or left
          if (left < 0) left = 0;
          if (top < 0) top = 0;

          toolTip.style.left = left + 'px';
          toolTip.style.top = top + 'px';

          // Preview Drawing Logic
          const currentPoints = drawingPointsRef.current;
          const currentTool = activeToolRef.current;
          const currentConfig = drawingConfigRef.current;

          if (currentPoints && currentPoints.length > 0 && currentTool && currentConfig && svgContainerRef.current) {
            const lastPoint = currentPoints[currentPoints.length - 1];
            const startX = chart.timeScale().timeToCoordinate(lastPoint.time as any);
            const startY = candlestickSeries.priceToCoordinate(lastPoint.price);

            if (startX !== null && startY !== null) {
              if (['Trend Line', 'Ray', 'Extended Line', 'Arrow', 'Fibonacci Retracement', 'Trend-Based Fib Extension', 'Head and Shoulders', 'Double Top', 'Double Bottom', 'Flag', 'Triangle'].includes(currentTool)) {
                if (!previewLineRef.current) {
                  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                  line.setAttribute('stroke', currentConfig.color);
                  line.setAttribute('stroke-width', currentConfig.lineWidth.toString());
                  if (currentConfig.lineStyle === 1) line.setAttribute('stroke-dasharray', '2,4');
                  if (currentConfig.lineStyle === 2) line.setAttribute('stroke-dasharray', '8,8');
                  line.style.pointerEvents = 'none';
                  svgContainerRef.current.appendChild(line);
                  previewLineRef.current = line;
                }
                previewLineRef.current.setAttribute('x1', startX.toString());
                previewLineRef.current.setAttribute('y1', startY.toString());
                previewLineRef.current.setAttribute('x2', x.toString());
                previewLineRef.current.setAttribute('y2', y.toString());
                previewLineRef.current.style.display = 'block';
              } else if (currentTool === 'Order Block' || currentTool === 'Rectangle') {
                if (!previewBoxRef.current) {
                  const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                  box.setAttribute('fill', currentConfig.color);
                  box.setAttribute('fill-opacity', '0.2');
                  box.setAttribute('stroke', currentConfig.color);
                  box.setAttribute('stroke-width', '1');
                  box.style.pointerEvents = 'none';
                  svgContainerRef.current.appendChild(box);
                  previewBoxRef.current = box;
                }
                const minX = Math.min(startX, x);
                const minY = Math.min(startY, y);
                const width = Math.abs(x - startX);
                const height = Math.abs(y - startY);
                previewBoxRef.current.setAttribute('x', minX.toString());
                previewBoxRef.current.setAttribute('y', minY.toString());
                previewBoxRef.current.setAttribute('width', width.toString());
                previewBoxRef.current.setAttribute('height', height.toString());
                previewBoxRef.current.style.display = 'block';
              }
            }
          } else {
            if (previewLineRef.current) previewLineRef.current.style.display = 'none';
            if (previewBoxRef.current) previewBoxRef.current.style.display = 'none';
          }
        } else {
          legend.innerHTML = '';
          toolTip.style.display = 'none';
          if (previewLineRef.current) previewLineRef.current.style.display = 'none';
          if (previewBoxRef.current) previewBoxRef.current.style.display = 'none';
        }
      }
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    let ws: WebSocket | null = null;
    let isMounted = true;

    const isCrypto = isCryptoAsset(asset);

    const intervalMap: Record<string, string> = {
      '1m': '1m', '5m': '5m', '15m': '15m',
      '1H': '1h', '4H': '4h', '1D': '1d',
      '1W': '1w', '1M': '1M'
    };
    const binanceInterval = intervalMap[timeframe] || '1d';

    const yahooIntervalMap: Record<string, { interval: string, range: string }> = {
      '1m': { interval: '1m', range: '7d' },
      '5m': { interval: '5m', range: '1mo' },
      '15m': { interval: '15m', range: '1mo' },
      '1H': { interval: '1h', range: '3mo' },
      '4H': { interval: '1h', range: '3mo' }, // Yahoo doesn't have 4h, fallback to 1h
      '1D': { interval: '1d', range: '2y' },
      '1W': { interval: '1wk', range: '5y' },
      '1M': { interval: '1mo', range: '10y' }
    };
    const yahooConfig = yahooIntervalMap[timeframe] || { interval: '1d', range: '2y' };

    const loadData = async () => {
      try {
        let formattedData: any[] = [];

        if (isCrypto) {
          let binanceSuccess = false;

          // 1. Try direct Binance (no backend needed)
          try {
            const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${asset}USDT&interval=${binanceInterval}&limit=1000`);
            if (res.ok) {
              const data = await res.json();
              if (!isMounted) return;
              if (Array.isArray(data)) {
                formattedData = data.map((d: any) => ({
                  time: (d[0] / 1000) as Time,
                  open: parseFloat(d[1]),
                  high: parseFloat(d[2]),
                  low: parseFloat(d[3]),
                  close: parseFloat(d[4]),
                  volume: parseFloat(d[5]),
                }));
                binanceSuccess = true;
              }
            }
          } catch { /* fall through */ }

          // 2. Try backend proxy
          if (!binanceSuccess) {
            try {
              const res = await fetch(`/api/crypto/klines?symbol=${asset}USDT&interval=${binanceInterval}&limit=1000`);
              if (res.ok) {
                const data = await res.json();
                if (!isMounted) return;
                if (Array.isArray(data)) {
                  formattedData = data.map((d: any) => ({
                    time: (d[0] / 1000) as Time,
                    open: parseFloat(d[1]),
                    high: parseFloat(d[2]),
                    low: parseFloat(d[3]),
                    close: parseFloat(d[4]),
                    volume: parseFloat(d[5]),
                  }));
                  binanceSuccess = true;
                }
              }
            } catch { /* fall through */ }
          }

          if (!binanceSuccess) {
            // 3. Yahoo Finance fallback
            const res = await fetch(`/api/history?symbol=${asset}-USD&interval=${yahooConfig.interval}&range=${yahooConfig.range}`);
            const json = await res.json();
            if (!isMounted) return;

            if (json.chart && json.chart.result && json.chart.result[0]) {
              const result = json.chart.result[0];
              const timestamps = result.timestamp;
              const quote = result.indicators.quote[0];

              for (let i = 0; i < timestamps.length; i++) {
                if (quote.close[i] !== null) {
                  formattedData.push({
                    time: timestamps[i] as Time,
                    open: quote.open[i],
                    high: quote.high[i],
                    low: quote.low[i],
                    close: quote.close[i],
                    volume: quote.volume[i] || 0,
                  });
                }
              }
            }
          }
        } else {
          // Fetch from backend proxy for Yahoo Finance
          const res = await fetch(`/api/history?symbol=${asset}&interval=${yahooConfig.interval}&range=${yahooConfig.range}`);
          const json = await res.json();
          if (!isMounted) return;

          if (json.chart && json.chart.result && json.chart.result[0]) {
            const result = json.chart.result[0];
            const timestamps = result.timestamp;
            const quote = result.indicators.quote[0];

            for (let i = 0; i < timestamps.length; i++) {
              if (quote.close[i] !== null) {
                formattedData.push({
                  time: timestamps[i] as Time,
                  open: quote.open[i],
                  high: quote.high[i],
                  low: quote.low[i],
                  close: quote.close[i],
                  volume: quote.volume[i] || 0,
                });
              }
            }
          }
        }

        fullDataRef.current = formattedData;
        candlestickSeries.setData(formattedData);

        const volumeData = formattedData.map((d: any) => ({
          time: d.time,
          value: d.volume,
          color: d.close >= d.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
        }));
        volumeSeries.setData(volumeData);

        const updateIndicators = (isUpdate = false) => {
          const data = fullDataRef.current;
          if (data.length === 0) return;

          if (indicatorSeries['SMA 20']) {
            const sma20 = calculateSMA(data, 20);
            isUpdate && sma20.length > 0 ? indicatorSeries['SMA 20'].update(sma20[sma20.length - 1]) : indicatorSeries['SMA 20'].setData(sma20);
          }
          if (indicatorSeries['SMA 50']) {
            const sma50 = calculateSMA(data, 50);
            isUpdate && sma50.length > 0 ? indicatorSeries['SMA 50'].update(sma50[sma50.length - 1]) : indicatorSeries['SMA 50'].setData(sma50);
          }
          if (indicatorSeries['SMA 200']) {
            const sma200 = calculateSMA(data, 200);
            isUpdate && sma200.length > 0 ? indicatorSeries['SMA 200'].update(sma200[sma200.length - 1]) : indicatorSeries['SMA 200'].setData(sma200);
          }
          if (indicatorSeries['EMA 20']) {
            const ema20 = calculateEMA(data, 20);
            isUpdate && ema20.length > 0 ? indicatorSeries['EMA 20'].update(ema20[ema20.length - 1]) : indicatorSeries['EMA 20'].setData(ema20);
          }
          if (indicatorSeries['EMA 50']) {
            const ema50 = calculateEMA(data, 50);
            isUpdate && ema50.length > 0 ? indicatorSeries['EMA 50'].update(ema50[ema50.length - 1]) : indicatorSeries['EMA 50'].setData(ema50);
          }
          if (indicatorSeries['RSI']) {
            const rsi = calculateRSI(data, 14);
            isUpdate && rsi.length > 0 ? indicatorSeries['RSI'].update(rsi[rsi.length - 1]) : indicatorSeries['RSI'].setData(rsi);
          }
          if (indicatorSeries['MACD_Line']) {
            const macd = calculateMACD(data);
            isUpdate && macd.macdLine.length > 0 ? indicatorSeries['MACD_Line'].update(macd.macdLine[macd.macdLine.length - 1]) : indicatorSeries['MACD_Line'].setData(macd.macdLine);
            isUpdate && macd.signalLine.length > 0 ? indicatorSeries['MACD_Signal'].update(macd.signalLine[macd.signalLine.length - 1]) : indicatorSeries['MACD_Signal'].setData(macd.signalLine);
            isUpdate && macd.histogram.length > 0 ? indicatorSeries['MACD_Hist'].update(macd.histogram[macd.histogram.length - 1]) : indicatorSeries['MACD_Hist'].setData(macd.histogram);
          }
        };

        updateIndicators();

        // Start WebSocket for live updates
        if (isCrypto) {
          const fetchRestKlines = async () => {
            if (!isMounted) return;
            try {
              const response = await fetch(`/api/crypto/klines?symbol=${asset.toLowerCase()}usdt&interval=${binanceInterval}&limit=1`);
              if (!response.ok) throw new Error('REST API failed');
              const data = await response.json();
              processRestKline(data);
            } catch (e) {
              console.error('REST Klines fallback failed:', e);
            }
          };

          const processRestKline = (data: any[]) => {
            if (!isMounted || !data || data.length === 0) return;
            const kline = data[data.length - 1];
            const candleTime = (kline[0] / 1000) as Time;
            const candle = {
              time: candleTime,
              open: parseFloat(kline[1]),
              high: parseFloat(kline[2]),
              low: parseFloat(kline[3]),
              close: parseFloat(kline[4]),
              volume: parseFloat(kline[5]),
            };

            candlestickSeries.update(candle);
            volumeSeries.update({
              time: candle.time,
              value: candle.volume,
              color: candle.close >= candle.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
            });

            const lastData = fullDataRef.current[fullDataRef.current.length - 1];
            if (lastData && lastData.time === candle.time) {
              fullDataRef.current[fullDataRef.current.length - 1] = candle;
            } else {
              fullDataRef.current.push(candle);
            }

            updateIndicators(true);
          };

          const connectWebSocket = (useUS: boolean = false) => {
            if (!isMounted) return;
            const baseUrl = useUS ? 'wss://stream.binance.us' : 'wss://stream.binance.com';
            ws = new WebSocket(`${baseUrl}/ws/${asset.toLowerCase()}usdt@kline_${binanceInterval}`);

            ws.onmessage = (event) => {
              if (!isMounted) return;
              const message = JSON.parse(event.data);

              if (message.code || message.msg) {
                if (!useUS) {
                  if (ws) ws.close();
                  connectWebSocket(true);
                } else {
                  if (ws) ws.close();
                  fetchRestKlines();
                }
                return;
              }

              if (message.k) {
                const kline = message.k;
                const candleTime = (kline.t / 1000) as Time;
                const candle = {
                  time: candleTime,
                  open: parseFloat(kline.o),
                  high: parseFloat(kline.h),
                  low: parseFloat(kline.l),
                  close: parseFloat(kline.c),
                  volume: parseFloat(kline.v),
                };

                candlestickSeries.update(candle);
                volumeSeries.update({
                  time: candle.time,
                  value: candle.volume,
                  color: candle.close >= candle.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
                });

                const lastData = fullDataRef.current[fullDataRef.current.length - 1];
                if (lastData && lastData.time === candle.time) {
                  fullDataRef.current[fullDataRef.current.length - 1] = candle;
                } else {
                  fullDataRef.current.push(candle);
                }

                updateIndicators(true);
              }
            };

            ws.onerror = () => {
              if (!useUS && isMounted) {
                if (ws) ws.close();
                connectWebSocket(true);
              } else if (isMounted) {
                if (ws) ws.close();
                fetchRestKlines();
              }
            };
          };

          connectWebSocket(false);
        } else {
          // Connect to our backend WebSocket for stocks
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
          ws.onopen = () => {
            ws?.send(JSON.stringify({ type: 'subscribe', symbol: asset, interval: yahooConfig.interval }));
          };
          ws.onmessage = (event) => {
            if (!isMounted) return;
            const data = JSON.parse(event.data);
            if (data.type === 'trade' && data.symbol === asset) {
              const lastData = fullDataRef.current[fullDataRef.current.length - 1];
              let candle;

              if (lastData) {
                // Always update the current candle for stocks to keep it simple
                candle = {
                  time: lastData.time,
                  open: lastData.open,
                  high: Math.max(lastData.high, data.price || data.close),
                  low: Math.min(lastData.low, data.price || data.close),
                  close: data.price || data.close,
                } as any;
                fullDataRef.current[fullDataRef.current.length - 1] = candle;
              } else {
                candle = {
                  time: data.time as Time,
                  open: data.open,
                  high: data.high,
                  low: data.low,
                  close: data.close,
                  volume: data.volume,
                };
                fullDataRef.current.push(candle);
              }

              candlestickSeries.update(candle);
              volumeSeries.update({
                time: candle.time,
                value: candle.volume,
                color: candle.close >= candle.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
              });

              updateIndicators(true);
            }
          };
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    loadData();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current);
    }

    return () => {
      isMounted = false;
      if (ws) ws.close();
      resizeObserver.disconnect();
      chart.remove();
      if (chartContainerRef.current) {
        if (legend.parentNode === chartContainerRef.current) {
          chartContainerRef.current.removeChild(legend);
        }
        if (toolTip.parentNode === chartContainerRef.current) {
          chartContainerRef.current.removeChild(toolTip);
        }
        if (svgContainer.parentNode === chartContainerRef.current) {
          chartContainerRef.current.removeChild(svgContainer);
        }
      }
    };
  }, [asset, timeframe, JSON.stringify(activeIndicators)]);

  useEffect(() => {
    if (seriesRef.current && colors) {
      seriesRef.current.applyOptions({
        upColor: colors.upColor,
        downColor: colors.downColor,
        borderVisible: colors.borderVisible,
        wickVisible: colors.wickVisible,
        wickUpColor: colors.upColor,
        wickDownColor: colors.downColor,
      });
    }
  }, [colors]);

  return (
    <div className="w-full h-full relative group">
      <div className="absolute top-4 left-4 z-10 text-white font-semibold text-xl bg-gray-900/50 px-3 py-1 rounded pointer-events-none">
        {asset} - {timeframe}
      </div>

      {/* Zoom/Pan Controls */}
      <div className="absolute bottom-6 right-16 z-10 flex gap-1 bg-[#0B0E14]/80 backdrop-blur-md p-1.5 rounded-xl border border-[#1F2937] shadow-xl opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (chartRef.current) {
              const range = chartRef.current.timeScale().getVisibleLogicalRange();
              if (range) {
                const diff = range.to - range.from;
                chartRef.current.timeScale().setVisibleLogicalRange({
                  from: range.from - diff * 0.1,
                  to: range.to - diff * 0.1,
                });
              }
            }
          }}
          className="p-2 text-gray-400 hover:text-white hover:bg-[#1F2937] rounded-lg transition-colors"
          title="Pan Left"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (chartRef.current) {
              const range = chartRef.current.timeScale().getVisibleLogicalRange();
              if (range) {
                const diff = range.to - range.from;
                chartRef.current.timeScale().setVisibleLogicalRange({
                  from: range.from + diff * 0.1,
                  to: range.to + diff * 0.1,
                });
              }
            }
          }}
          className="p-2 text-gray-400 hover:text-white hover:bg-[#1F2937] rounded-lg transition-colors"
          title="Pan Right"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
        </button>
        <div className="w-px bg-[#1F2937] mx-1 my-1" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (chartRef.current) {
              const range = chartRef.current.timeScale().getVisibleLogicalRange();
              if (range) {
                const diff = range.to - range.from;
                chartRef.current.timeScale().setVisibleLogicalRange({
                  from: range.from + diff * 0.1,
                  to: range.to - diff * 0.1,
                });
              }
            }
          }}
          className="p-2 text-gray-400 hover:text-white hover:bg-[#1F2937] rounded-lg transition-colors"
          title="Zoom In"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" x2="16.65" y1="21" y2="16.65" /><line x1="11" x2="11" y1="8" y2="14" /><line x1="8" x2="14" y1="11" y2="11" /></svg>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (chartRef.current) {
              const range = chartRef.current.timeScale().getVisibleLogicalRange();
              if (range) {
                const diff = range.to - range.from;
                chartRef.current.timeScale().setVisibleLogicalRange({
                  from: range.from - diff * 0.1,
                  to: range.to + diff * 0.1,
                });
              }
            }
          }}
          className="p-2 text-gray-400 hover:text-white hover:bg-[#1F2937] rounded-lg transition-colors"
          title="Zoom Out"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" x2="16.65" y1="21" y2="16.65" /><line x1="8" x2="14" y1="11" y2="11" /></svg>
        </button>
        <div className="w-px bg-[#1F2937] mx-1 my-1" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (chartRef.current) {
              chartRef.current.timeScale().fitContent();
            }
          }}
          className="p-2 text-gray-400 hover:text-white hover:bg-[#1F2937] rounded-lg transition-colors"
          title="Reset View"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
        </button>
      </div>

      <div ref={chartContainerRef} className="w-full h-full overflow-hidden scrollbar-hide" />
    </div>
  );
});

Chart.displayName = 'Chart';
