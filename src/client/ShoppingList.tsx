import React, { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown, ChevronUp, Plus, Download, Printer, Trash2,
  Check, ChevronRight,
} from 'lucide-react';
import { Recipe, ShoppingItem, IngredientCategory, CATEGORY_LABELS, CATEGORY_COLORS } from './types';

interface ShoppingListProps {
  recipes: Recipe[];
  onViewRecipeDetail: (recipe: Recipe) => void;
}

type ManualIngredient = {
  name: string;
  amount: string;
  unit: string;
  category: IngredientCategory;
};

const ShoppingList: React.FC<ShoppingListProps> = ({ recipes, onViewRecipeDetail }) => {
  const [selectedRecipes, setSelectedRecipes] = useState<Map<string, Set<string>>>(new Map());
  const [expandedRecipe, setExpandedRecipe] = useState<string | null>(null);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<IngredientCategory>>(new Set());
  const [manualName, setManualName] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [manualUnit, setManualUnit] = useState('克');
  const [manualCategory, setManualCategory] = useState<IngredientCategory>('other');
  const [manualItems, setManualItems] = useState<ManualIngredient[]>([]);

  const toggleRecipe = (recipeId: string) => {
    setSelectedRecipes((prev) => {
      const next = new Map(prev);
      if (next.has(recipeId)) {
        next.delete(recipeId);
      } else {
        const recipe = recipes.find((r) => r.id === recipeId);
        if (recipe) {
          next.set(recipeId, new Set(recipe.ingredients.map((i) => i.name)));
        }
      }
      return next;
    });
  };

  const toggleIngredient = (recipeId: string, ingredientName: string) => {
    setSelectedRecipes((prev) => {
      const next = new Map(prev);
      let ings = next.get(recipeId);
      if (!ings) {
        ings = new Set();
        next.set(recipeId, ings);
      }
      if (ings.has(ingredientName)) {
        ings.delete(ingredientName);
      } else {
        ings.add(ingredientName);
      }
      if (ings.size === 0) next.delete(recipeId);
      return next;
    });
  };

  const generateShoppingList = useCallback(async () => {
    const selectedIngredients = Array.from(selectedRecipes.entries()).map(([recipeId, ingSet]) => ({
      recipeId,
      ingredientNames: Array.from(ingSet),
    }));
    const manualItemsPayload = manualItems.map((m) => ({
      name: m.name,
      amount: parseFloat(m.amount) || 0,
      unit: m.unit,
      category: m.category,
    }));
    try {
      const res = await fetch('/api/shopping/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedIngredients, manualItems: manualItemsPayload }),
      });
      if (!res.ok) throw new Error('生成购物清单失败');
      const data: ShoppingItem[] = await res.json();
      setItems((prev) => {
        const idToChecked = new Map(prev.map((i) => [i.name.toLowerCase(), i.checked]));
        return data.map((item) => ({
          ...item,
          checked: idToChecked.get(item.name.toLowerCase()) || false,
        }));
      });
    } catch (err) {
      console.error('生成购物清单失败:', err);
      alert('生成购物清单失败，请重试');
    }
  }, [selectedRecipes, manualItems]);

  useEffect(() => {
    generateShoppingList();
  }, [generateShoppingList]);

  const toggleItemChecked = (itemId: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, checked: !it.checked } : it))
    );
  };

  const removeItem = (itemId: string) => {
    setItems((prev) => prev.filter((it) => it.id !== itemId));
  };

  const toggleCategory = (cat: IngredientCategory) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const addManualItem = () => {
    if (!manualName.trim()) return;
    setManualItems((prev) => [
      ...prev,
      {
        name: manualName.trim(),
        amount: manualAmount || '1',
        unit: manualUnit,
        category: manualCategory,
      },
    ]);
    setManualName('');
    setManualAmount('');
    setManualUnit('克');
    setManualCategory('other');
  };

  const removeManualItem = (idx: number) => {
    setManualItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const exportToText = () => {
    const lines: string[] = ['🛒 购物清单 - ' + new Date().toLocaleDateString('zh-CN'), ''];
    const grouped = groupByCategory(items);
    for (const [cat, catItems] of Object.entries(grouped)) {
      lines.push(`【${CATEGORY_LABELS[cat as IngredientCategory]}】`);
      catItems.forEach((it) => {
        const mark = it.checked ? '✅' : '⬜';
        lines.push(`${mark} ${it.name}  ${it.amount}${it.unit}`);
      });
      lines.push('');
    }
    const text = lines.join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `购物清单_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const groupByCategory = (list: ShoppingItem[]) => {
    const result: Partial<Record<IngredientCategory, ShoppingItem[]>> = {};
    list.forEach((it) => {
      if (!result[it.category]) result[it.category] = [];
      result[it.category]!.push(it);
    });
    return result;
  };

  const groupedItems = groupByCategory(items);
  const totalItems = items.length;
  const checkedItems = items.filter((i) => i.checked).length;

  return (
    <div>
      <h1 className="page-title">🛒 购物清单</h1>
      <p className="page-subtitle">
        从左侧食谱中勾选需要采购的食材，系统自动去重并按类别分组。
        {totalItems > 0 && ` 共 ${totalItems} 项，已完成 ${checkedItems} 项。`}
      </p>

      <div className="shopping-layout">
        <aside className="shopping-sidebar">
          <h3>📖 选择食谱</h3>
          <div className="recipe-mini-list">
            {recipes.map((r) => {
              const isSelected = selectedRecipes.has(r.id);
              const isExpanded = expandedRecipe === r.id;
              return (
                <div key={r.id}>
                  <div
                    className={`recipe-mini-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleRecipe(r.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedRecipe(isExpanded ? null : r.id);
                        }}
                        style={{ color: 'var(--color-text-light)', cursor: 'pointer', display: 'inline-flex' }}
                      >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div className="recipe-mini-name">{r.name}</div>
                        <div className="recipe-mini-count">{r.ingredients.length}种食材</div>
                      </div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="ingredient-mini-select">
                      {r.ingredients.map((ing) => {
                        const ings = selectedRecipes.get(r.id);
                        const checked = ings ? ings.has(ing.name) : false;
                        return (
                          <label
                            key={ing.name}
                            className="ingredient-mini-option"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleIngredient(r.id, ing.name)}
                            />
                            <span>{ing.name}</span>
                            <span style={{ marginLeft: 'auto', color: 'var(--color-text-light)' }}>
                              {ing.amount}{ing.unit}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <h3 style={{ marginTop: 20 }}>✏️ 手动添加</h3>
          {manualItems.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
              {manualItems.map((m, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 8px',
                    background: 'var(--color-warm-white)',
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  <div
                    className="category-color"
                    style={{ background: CATEGORY_COLORS[m.category], width: 10, height: 10 }}
                  />
                  <span style={{ flex: 1, fontWeight: 500 }}>{m.name}</span>
                  <span style={{ color: 'var(--color-text-light)' }}>{m.amount}{m.unit}</span>
                  <button
                    className="remove-btn"
                    style={{ width: 24, height: 24, fontSize: 11, padding: 0 }}
                    onClick={() => removeManualItem(idx)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="manual-add-form">
            <input
              className="form-input"
              placeholder="食材名称"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addManualItem()}
            />
            <div className="manual-add-row">
              <input
                className="form-input"
                placeholder="数量"
                type="number"
                min="0"
                value={manualAmount}
                onChange={(e) => setManualAmount(e.target.value)}
              />
              <select
                className="form-select"
                value={manualUnit}
                onChange={(e) => setManualUnit(e.target.value)}
              >
                {['克', '毫升', '个', '根', '把', '颗', '勺'].map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
              <select
                className="form-select"
                value={manualCategory}
                onChange={(e) => setManualCategory(e.target.value as IngredientCategory)}
              >
                {(Object.keys(CATEGORY_LABELS) as IngredientCategory[]).map((k) => (
                  <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary btn-sm" onClick={addManualItem} style={{ justifyContent: 'center' }}>
              <Plus size={14} /> 添加
            </button>
          </div>
        </aside>

        <div className="shopping-main">
          <div className="shopping-header">
            <h2>
              清单总览
              {totalItems > 0 && (
                <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--color-text-light)', marginLeft: 10 }}>
                  {checkedItems}/{totalItems} 已完成
                </span>
              )}
            </h2>
            <div className="shopping-actions">
              <button className="btn btn-secondary btn-sm" onClick={exportToText} disabled={totalItems === 0}>
                <Download size={14} /> 导出
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => window.print()} disabled={totalItems === 0}>
                <Printer size={14} /> 打印
              </button>
            </div>
          </div>

          {totalItems === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🛒</div>
              <h3>购物清单还是空的</h3>
              <p>从左侧选择食谱并勾选食材，开始准备你的采购清单吧！</p>
            </div>
          ) : (
            (Object.keys(groupedItems) as IngredientCategory[]).map((cat) => {
              const catItems = groupedItems[cat]!;
              const isCollapsed = collapsedCategories.has(cat);
              const catChecked = catItems.filter((i) => i.checked).length;
              return (
                <div key={cat} className="shopping-category">
                  <div className="category-header" onClick={() => toggleCategory(cat)}>
                    <div className="category-color" style={{ background: CATEGORY_COLORS[cat] }} />
                    <span className="category-name">{CATEGORY_LABELS[cat]}</span>
                    <span className="category-count">{catChecked}/{catItems.length}</span>
                    {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                  </div>
                  {!isCollapsed && (
                    <ul className="shopping-items">
                      {catItems.map((it) => (
                        <li key={it.id} className={`shopping-item ${it.checked ? 'checked' : ''}`}>
                          <div
                            className={`shopping-item-checkbox ${it.checked ? 'checked' : ''}`}
                            onClick={() => toggleItemChecked(it.id)}
                          >
                            {it.checked && <Check size={14} />}
                          </div>
                          <div className="shopping-item-info">
                            <span className="shopping-item-name">{it.name}</span>
                            <span className="shopping-item-amount">
                              {it.amount}{it.unit}
                              {it.sourceRecipes.length > 0 && (
                                <span style={{ marginLeft: 8, opacity: 0.7 }}>
                                  · 来自 {it.sourceRecipes.length} 道食谱
                                </span>
                              )}
                              {it.sourceRecipes.length === 1 && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const rid = it.sourceRecipes[0];
                                    const rr = recipes.find((x) => x.id === rid);
                                    if (rr) onViewRecipeDetail(rr);
                                  }}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--color-warm-orange)',
                                    cursor: 'pointer',
                                    fontSize: 12,
                                    padding: 0,
                                    marginLeft: 4,
                                  }}
                                >
                                  查看食谱
                                </button>
                              )}
                            </span>
                          </div>
                          <button
                            className="shopping-item-remove"
                            onClick={() => removeItem(it.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default ShoppingList;
