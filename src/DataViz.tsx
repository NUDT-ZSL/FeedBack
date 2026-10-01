import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export interface DataPoint {
  label: string;
  value: number;
}

interface DataVizProps {
  data: DataPoint[];
  chartType: 'bar' | 'line';
  animateKey?: string | number;
}

const DataViz: React.FC<DataVizProps> = ({ data, chartType, animateKey }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    if (width === 0 || height === 0) return;

    const margin = { top: 20, right: 24, bottom: 40, left: 50 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    if (!svgRef.current) {
      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet');
      svgRef.current = svg.node();
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');

    const gradient = defs.append('linearGradient')
      .attr('id', `bar-gradient-${chartType}`)
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#a78bfa');

    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#7c3aed');

    const areaGradient = defs.append('linearGradient')
      .attr('id', 'area-gradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    areaGradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#a78bfa')
      .attr('stop-opacity', 0.35);

    areaGradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#7c3aed')
      .attr('stop-opacity', 0.02);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3.scaleBand()
      .domain(data.map(d => d.label))
      .range([0, innerWidth])
      .padding(0.25);

    const maxValue = d3.max(data, d => d.value) || 0;
    const yMax = maxValue * 1.15 || 10;

    const yScale = d3.scaleLinear()
      .domain([0, yMax])
      .range([innerHeight, 0])
      .nice();

    const yAxis = g.append('g')
      .attr('class', 'y-axis');

    yAxis.call(
      d3.axisLeft(yScale)
        .ticks(5)
        .tickSize(-innerWidth)
        .tickFormat(d => d3.format(',')(d as number))
    );

    yAxis.selectAll('.tick line')
      .attr('stroke', 'rgba(255, 255, 255, 0.06)')
      .attr('stroke-dasharray', '3,3');

    yAxis.selectAll('.tick text')
      .attr('fill', '#64748b')
      .attr('font-size', '11px')
      .attr('font-family', "'JetBrains Mono', monospace");

    yAxis.select('.domain').remove();

    const xAxis = g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${innerHeight})`);

    xAxis.call(d3.axisBottom(xScale));

    xAxis.selectAll('.tick text')
      .attr('fill', '#94a3b8')
      .attr('font-size', '12px')
      .attr('font-weight', '500');

    xAxis.selectAll('.tick line').remove();
    xAxis.select('.domain')
      .attr('stroke', 'rgba(255, 255, 255, 0.08)');

    if (chartType === 'bar') {
      const bars = g.selectAll('.bar')
        .data(data)
        .enter()
        .append('rect')
        .attr('class', 'bar')
        .attr('x', d => xScale(d.label)!)
        .attr('width', xScale.bandwidth())
        .attr('y', innerHeight)
        .attr('height', 0)
        .attr('rx', 6)
        .attr('fill', `url(#bar-gradient-${chartType})`)
        .attr('filter', 'url(#glow)');

      const filter = defs.append('filter')
        .attr('id', 'glow')
        .attr('x', '-50%')
        .attr('y', '-50%')
        .attr('width', '200%')
        .attr('height', '200%');

      filter.append('feGaussianBlur')
        .attr('stdDeviation', '2')
        .attr('result', 'coloredBlur');

      const feMerge = filter.append('feMerge');
      feMerge.append('feMergeNode').attr('in', 'coloredBlur');
      feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

      bars.transition()
        .duration(800)
        .delay((_, i) => i * 80)
        .ease(d3.easeCubicOut)
        .attr('y', d => yScale(d.value))
        .attr('height', d => innerHeight - yScale(d.value));

      bars.on('mouseenter', function (event, d) {
        d3.select(this)
          .transition()
          .duration(150)
          .attr('opacity', 0.85)
          .attr('transform', `translate(0,-2)`);

        const tooltip = g.append('g')
          .attr('class', 'tooltip')
          .attr('transform', `translate(${xScale(d.label)! + xScale.bandwidth() / 2},${yScale(d.value) - 12})`);

        const text = tooltip.append('text')
          .attr('text-anchor', 'middle')
          .attr('fill', '#f8fafc')
          .attr('font-size', '12px')
          .attr('font-weight', '600')
          .text(d3.format(',')(d.value));

        const bbox = text.node()!.getBBox();
        tooltip.insert('rect', 'text')
          .attr('x', bbox.x - 8)
          .attr('y', bbox.y - 5)
          .attr('width', bbox.width + 16)
          .attr('height', bbox.height + 10)
          .attr('rx', 5)
          .attr('fill', '#1e293b')
          .attr('stroke', '#7c3aed')
          .attr('stroke-width', 1);
      })
      .on('mouseleave', function () {
        d3.select(this)
          .transition()
          .duration(150)
          .attr('opacity', 1)
          .attr('transform', 'translate(0,0)');

        g.selectAll('.tooltip').remove();
      });
    } else {
      const line = d3.line<DataPoint>()
        .x(d => xScale(d.label)! + xScale.bandwidth() / 2)
        .y(d => yScale(d.value))
        .curve(d3.curveMonotoneX);

      const area = d3.area<DataPoint>()
        .x(d => xScale(d.label)! + xScale.bandwidth() / 2)
        .y0(innerHeight)
        .y1(d => yScale(d.value))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(data)
        .attr('class', 'area')
        .attr('d', area)
        .attr('fill', 'url(#area-gradient)')
        .attr('opacity', 0);

      g.select('.area')
        .transition()
        .duration(800)
        .ease(d3.easeCubicOut)
        .attr('opacity', 1);

      const path = g.append('path')
        .datum(data)
        .attr('class', 'line')
        .attr('fill', 'none')
        .attr('stroke', 'url(#bar-gradient-line)')
        .attr('stroke-width', 3)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round');

      const lineGradient = defs.append('linearGradient')
        .attr('id', 'bar-gradient-line')
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '100%')
        .attr('y2', '0%');

      lineGradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', '#7c3aed');

      lineGradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', '#a78bfa');

      const totalLength = (path.node() as SVGPathElement)?.getTotalLength() || 0;

      path.attr('stroke-dasharray', `${totalLength} ${totalLength}`)
        .attr('stroke-dashoffset', totalLength)
        .transition()
        .duration(1000)
        .ease(d3.easeCubicOut)
        .attr('stroke-dashoffset', 0);

      const dots = g.selectAll('.dot')
        .data(data)
        .enter()
        .append('g')
        .attr('class', 'dot-group')
        .attr('transform', d => `translate(${xScale(d.label)! + xScale.bandwidth() / 2},${innerHeight})`)
        .style('opacity', 0);

      dots.transition()
        .duration(600)
        .delay((_, i) => 400 + i * 100)
        .ease(d3.easeCubicOut)
        .attr('transform', d => `translate(${xScale(d.label)! + xScale.bandwidth() / 2},${yScale(d.value)})`)
        .style('opacity', 1);

      dots.append('circle')
        .attr('class', 'dot-outer')
        .attr('r', 8)
        .attr('fill', 'rgba(124, 58, 237, 0.2)');

      dots.append('circle')
        .attr('class', 'dot')
        .attr('r', 5)
        .attr('fill', '#a78bfa')
        .attr('stroke', '#0f172a')
        .attr('stroke-width', 2);

      dots.on('mouseenter', function (event, d) {
        d3.select(this).select('.dot-outer')
          .transition()
          .duration(150)
          .attr('r', 12);

        d3.select(this).select('.dot')
          .transition()
          .duration(150)
          .attr('r', 6);

        const tooltip = g.append('g')
          .attr('class', 'tooltip')
          .attr('transform', `translate(${xScale(d.label)! + xScale.bandwidth() / 2},${yScale(d.value) - 22})`);

        const text = tooltip.append('text')
          .attr('text-anchor', 'middle')
          .attr('fill', '#f8fafc')
          .attr('font-size', '12px')
          .attr('font-weight', '600')
          .text(d3.format(',')(d.value));

        const bbox = text.node()!.getBBox();
        tooltip.insert('rect', 'text')
          .attr('x', bbox.x - 8)
          .attr('y', bbox.y - 5)
          .attr('width', bbox.width + 16)
          .attr('height', bbox.height + 10)
          .attr('rx', 5)
          .attr('fill', '#1e293b')
          .attr('stroke', '#7c3aed')
          .attr('stroke-width', 1);
      })
      .on('mouseleave', function () {
        d3.select(this).select('.dot-outer')
          .transition()
          .duration(150)
          .attr('r', 8);

        d3.select(this).select('.dot')
          .transition()
          .duration(150)
          .attr('r', 5);

        g.selectAll('.tooltip').remove();
      });
    }

    const handleResize = () => {
      if (!containerRef.current) return;
      const newWidth = containerRef.current.clientWidth;
      const newHeight = containerRef.current.clientHeight;
      if (svgRef.current && newWidth > 0 && newHeight > 0) {
        d3.select(svgRef.current)
          .attr('viewBox', `0 0 ${newWidth} ${newHeight}`);
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [data, chartType, animateKey]);

  return <div ref={containerRef} className="chart-container" />;
};

export default DataViz;
