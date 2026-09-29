import { memo } from 'react';
import { InventoryTracker } from '@/modules/inventory/InventoryTracker';

export const InventoryPage = memo(function InventoryPage() {
  return <InventoryTracker />;
});
