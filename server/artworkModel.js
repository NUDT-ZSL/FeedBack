const artworks = [
  {
    id: '1',
    title: '青瓷莲花盏',
    description: '手工拉坯制作的青瓷茶盏，每一个都独一无二。采用龙泉青瓷传统工艺，釉色温润如玉，盏身雕刻莲花纹样，寓意清雅高洁。限量100件，每件底部都有大师手刻编号。',
    price: 588,
    stock: 15,
    limitedEdition: 100,
    thumbnail: 'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=400&h=400&fit=crop',
    image: 'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=800&h=600&fit=crop',
    createdAt: '2024-01-15',
    artistName: '李明远',
  },
  {
    id: '2',
    title: '手绘山水折扇',
    description: '采用苏州传统折扇工艺，扇骨为精选老竹，扇面为桑皮宣纸。由知名国画大师手绘青绿山水，每一幅都是孤品。扇骨雕刻精细花纹，开合流畅，手感舒适。',
    price: 328,
    stock: 42,
    limitedEdition: 80,
    thumbnail: 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=400&h=400&fit=crop',
    image: 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=800&h=600&fit=crop',
    createdAt: '2024-02-20',
    artistName: '王清韵',
  },
  {
    id: '3',
    title: '手工编织藤篮',
    description: '选用云南深山野生藤条，经过晾晒、蒸煮、染色等多道工序，由老艺人手工编织而成。藤篮结实耐用，纹理自然美观，可用于收纳或装饰。',
    price: 258,
    stock: 8,
    limitedEdition: 50,
    thumbnail: 'https://images.unsplash.com/photo-1595231776515-ddffb1f4eb73?w=400&h=400&fit=crop',
    image: 'https://images.unsplash.com/photo-1595231776515-ddffb1f4eb73?w=800&h=600&fit=crop',
    createdAt: '2024-03-10',
    artistName: '张秀英',
  },
  {
    id: '4',
    title: '紫砂茶壶套装',
    description: '宜兴原矿紫砂泥料，全手工制作。壶身雕刻诗词，配有四杯四盏。紫砂壶透气性好，泡茶色香味皆蕴，是品茗收藏佳品。',
    price: 1288,
    stock: 0,
    limitedEdition: 30,
    thumbnail: 'https://images.unsplash.com/photo-1530968033775-2c92736b131e?w=400&h=400&fit=crop',
    image: 'https://images.unsplash.com/photo-1530968033775-2c92736b131e?w=800&h=600&fit=crop',
    createdAt: '2024-01-28',
    artistName: '陈大师',
  },
  {
    id: '5',
    title: '刺绣牡丹挂画',
    description: '苏绣工艺，蚕丝线手工刺绣。牡丹图案栩栩如生，针法细腻，色彩过渡自然。装裱采用优质实木画框，适合客厅、书房装饰。',
    price: 888,
    stock: 25,
    limitedEdition: 60,
    thumbnail: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=400&h=400&fit=crop',
    image: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&h=600&fit=crop',
    createdAt: '2024-02-14',
    artistName: '刘锦绣',
  },
  {
    id: '6',
    title: '木雕貔貅摆件',
    description: '选用名贵黄杨木，由资深木雕师精雕细琢而成。貔貅造型威武，细节丰富，寓意招财进宝。每件作品都经过精细打磨，手感温润。',
    price: 666,
    stock: 12,
    limitedEdition: 40,
    thumbnail: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=400&fit=crop',
    image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&h=600&fit=crop',
    createdAt: '2024-03-05',
    artistName: '赵天工',
  },
];

const getArtworks = () => artworks;

const getArtworkById = (id) => artworks.find((a) => a.id === id);

const updateArtworkStock = (id, quantity) => {
  const artwork = artworks.find((a) => a.id === id);
  if (!artwork || artwork.stock < quantity) return false;
  artwork.stock -= quantity;
  return true;
};

module.exports = { getArtworks, getArtworkById, updateArtworkStock };
