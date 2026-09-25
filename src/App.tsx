import { useState, useCallback, useMemo } from 'react';
import Scene3D from './Scene3D';
import Sidebar from './Sidebar';
import { mockProducts } from './data';
import type { Product, FilterState } from './types';
const App: React.FC = () => {
 const [products] = useState<Product[]>(mockProducts);
 const [selectedIds, setSelectedIds] = useState<string[]>([]);
 const [filters, setFilters] = useState<FilterState>({
 priceRange: [0, 5000],
 sizeRange: [10, 100],
 colors: [],
 materials: []
 });
 const [isFilterReset, setIsFilterReset] = useState(false);
 const handleSelectProduct = useCallback((id: string) => {
 setSelectedIds(prev => {
 if (prev.includes(id)) {
 return prev.filter(pid => pid !== id);
 }
 if (prev.length >= 4) {
 return [...prev.slice(1), id];
 }
 return [...prev, id];
 });
 }, []);
 const handleFiltersChange = useCallback((newFilters: FilterState) => {
 setFilters(newFilters);
 setIsFilterReset(false);
 }, []);
 const handleResetFilters = useCallback(() => {
 setFilters({
 priceRange: [0, 5000],
 sizeRange: [10, 100],
 colors: [],
 materials: []
 });
 setIsFilterReset(true);
 setTimeout(() => setIsFilterReset(false), 100);
 }, []);
 const selectedProducts = useMemo(() => {
 return products.filter(p => selectedIds.includes(p.id));
 }, [products, selectedIds]);
 return (<div className="app-container">
 <Sidebar products={products} selectedProducts={selectedProducts} filters={filters} onFiltersChange={handleFiltersChange} onResetFilters={handleResetFilters} onSelectProduct={handleSelectProduct}/>
 <div className="scene-container">
 <Scene3D products={products} selectedIds={selectedIds} filters={filters} isFilterReset={isFilterReset} onSelectProduct={handleSelectProduct}/>
 </div>
 <style>{`
 .app-container {
 width: 100%;
 height: 100%;
 position: relative;
 background-color: #1a1a2e;
 overflow: hidden;
 }
 .scene-container {
 position: absolute;
 top: 0;
 right: 0;
 bottom: 0;
 left: 320px;
 }
 @media (max-width: 768px) {
 .sidebar {
 left: 0 !important;
 right: 0 !important;
 top: auto !important;
 bottom: 0 !important;
 width: 100% !important;
 height: 200px !important;
 border-right: none !important;
 border-top: 1px solid rgba(255,255,255,0.1);
 }
 .scene-container {
 left: 0 !important;
 bottom: 200px !important;
 right: 0 !important;
 top: 0 !important;
 }
 }
 `}</style>
 </div>);
};
export default App;
