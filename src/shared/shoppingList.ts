export interface CheckableItem {
  name: string;
  checked: boolean;
}

/**
 * 重新生成购物清单后，按食材名（忽略大小写）保留之前的勾选状态；
 * 新出现的条目默认未勾选。
 */
export function preserveCheckedState<T extends CheckableItem>(
  previous: CheckableItem[],
  next: T[]
): T[] {
  const checkedByName = new Map(previous.map((i) => [i.name.toLowerCase(), i.checked]));
  return next.map((item) => ({
    ...item,
    checked: checkedByName.get(item.name.toLowerCase()) || false,
  }));
}
