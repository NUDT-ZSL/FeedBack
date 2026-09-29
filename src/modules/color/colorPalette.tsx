import { useState, useRef, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { HexColorPicker } from "react-colorful";
import { normalizeHex, isValidHex } from "../export/cssExport";

interface SortableSwatchProps {
  id: string;
  color: string;
  index: number;
  selected: boolean;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
}

function SortableSwatch({
  id,
  color,
  index,
  selected,
  onSelect,
  onRemove,
}: SortableSwatchProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="color-swatch-wrapper"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(index);
      }}
    >
      <div
        {...attributes}
        {...listeners}
        className={`color-swatch ${selected ? "selected" : ""} ${
          isDragging ? "dragging" : ""
        }`}
        style={{ backgroundColor: color }}
      />
      <button
        className="color-swatch-remove"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(index);
        }}
        title="移除"
      >
        ×
      </button>
    </div>
  );
}

interface ColorPaletteProps {
  colors: string[];
  selectedIndex: number;
  onSelectColor: (index: number) => void;
  onUpdateColor: (index: number, color: string) => void;
  onAddColor: (color: string) => void;
  onRemoveColor: (index: number) => void;
  onReorderColors: (from: number, to: number) => void;
  onSaveScheme: () => void;
  onExportCSS: () => void;
}

export default function ColorPalette({
  colors,
  selectedIndex,
  onSelectColor,
  onUpdateColor,
  onAddColor,
  onRemoveColor,
  onReorderColors,
  onSaveScheme,
  onExportCSS,
}: ColorPaletteProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hexInput, setHexInput] = useState(colors[selectedIndex] || "#000000");
  const [activeId, setActiveId] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const swatchContainerRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    setHexInput(colors[selectedIndex] || "#000000");
  }, [colors, selectedIndex]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        swatchContainerRef.current &&
        !swatchContainerRef.current.contains(e.target as Node)
      ) {
        setPickerOpen(false);
      }
    }
    if (pickerOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [pickerOpen]);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const fromIndex = colors.findIndex((_, i) => `color-${i}` === active.id);
      const toIndex = colors.findIndex((_, i) => `color-${i}` === over.id);
      if (fromIndex !== -1 && toIndex !== -1) {
        onReorderColors(fromIndex, toIndex);
      }
    }
  }

  function handleColorChange(hex: string) {
    setHexInput(hex);
    onUpdateColor(selectedIndex, hex.toUpperCase());
  }

  function handleHexInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setHexInput(val);
    if (isValidHex(val)) {
      onUpdateColor(selectedIndex, normalizeHex(val));
    }
  }

  function handleAddColor() {
    const randomColor =
      "#" +
      Math.floor(Math.random() * 0xffffff)
        .toString(16)
        .padStart(6, "0")
        .toUpperCase();
    onAddColor(randomColor);
  }

  function handleSwatchClick(index: number) {
    onSelectColor(index);
    setPickerOpen(true);
  }

  const activeColor =
    activeId !== null ? colors[colors.findIndex((_, i) => `color-${i}` === activeId)] : null;

  return (
    <div className="toolbar">
      <div className="color-swatches" ref={swatchContainerRef}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={colors.map((_, i) => `color-${i}`)}
            strategy={horizontalListSortingStrategy}
          >
            {colors.map((color, i) => (
              <SortableSwatch
                key={`color-${i}`}
                id={`color-${i}`}
                color={color}
                index={i}
                selected={i === selectedIndex}
                onSelect={handleSwatchClick}
                onRemove={onRemoveColor}
              />
            ))}
          </SortableContext>
          <DragOverlay>
            {activeColor ? (
              <div
                className="color-swatch dragging"
                style={{ backgroundColor: activeColor }}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
        <button className="add-color-btn" onClick={handleAddColor} title="添加颜色">
          +
        </button>
      </div>

      {pickerOpen && (
        <div className="color-picker-popover" ref={popoverRef}>
          <HexColorPicker
            color={hexInput}
            onChange={handleColorChange}
            style={{ width: 200, height: 200 }}
          />
          <input
            type="text"
            value={hexInput}
            onChange={handleHexInputChange}
            placeholder="#FFFFFF"
            maxLength={7}
          />
        </div>
      )}

      <div className="toolbar-actions">
        <button className="btn" onClick={onSaveScheme}>
          保存方案
        </button>
        <button className="btn btn-primary" onClick={onExportCSS}>
          导出 CSS
        </button>
      </div>
    </div>
  );
}
