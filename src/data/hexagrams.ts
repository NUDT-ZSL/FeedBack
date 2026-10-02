export interface Hexagram {
  name: string;
  guaCi: string;
  xiangCi: string;
  fortune: '吉' | '凶' | '中' | '大吉' | '小吉' | '小凶';
}

const hexagramsData: [number, Hexagram][] = [
  [0, { name: '坤为地', guaCi: '元亨，利牝马之贞。君子有攸往，先迷后得主，利西南得朋，东北丧朋。安贞吉。', xiangCi: '地势坤，君子以厚德载物。', fortune: '吉' }],
  [1, { name: '山地剥', guaCi: '不利有攸往。', xiangCi: '山附于地，剥；上以厚下，安宅。', fortune: '凶' }],
  [2, { name: '水地比', guaCi: '吉。原筮元永贞，无咎。不宁方来，后夫凶。', xiangCi: '地上有水，比；先王以建万国，亲诸侯。', fortune: '吉' }],
  [3, { name: '风地观', guaCi: '盥而不荐，有孚颙若。', xiangCi: '风行地上，观；先王以省方，观民设教。', fortune: '中' }],
  [4, { name: '地山谦', guaCi: '亨，君子有终。', xiangCi: '地中有山，谦；君子以裒多益寡，称物平施。', fortune: '吉' }],
  [5, { name: '火地晋', guaCi: '康侯用锡马蕃庶，昼日三接。', xiangCi: '明出地上，晋；君子以自昭明德。', fortune: '吉' }],
  [7, { name: '天地否', guaCi: '否之匪人，不利君子贞，大往小来。', xiangCi: '天地不交，否；君子以俭德辟难，不可荣以禄。', fortune: '凶' }],
  [8, { name: '雷地豫', guaCi: '利建侯行师。', xiangCi: '雷出地奋，豫；先王以作乐崇德，殷荐之上帝，以配祖考。', fortune: '吉' }],
  [10, { name: '山水蒙', guaCi: '亨。匪我求童蒙，童蒙求我。初噬告，再三渎，渎则不告。利贞。', xiangCi: '山下出泉，蒙；君子以果行育德。', fortune: '中' }],
  [13, { name: '山火贲', guaCi: '亨，小利有攸往。', xiangCi: '山下有火，贲；君子以明庶政，无敢折狱。', fortune: '小吉' }],
  [15, { name: '天山遁', guaCi: '亨，小利贞。', xiangCi: '天下有山，遁；君子以远小人，不恶而严。', fortune: '小吉' }],
  [16, { name: '地水师', guaCi: '贞，丈人吉，无咎。', xiangCi: '地中有水，师；君子以容民畜众。', fortune: '吉' }],
  [17, { name: '水雷屯', guaCi: '元亨利贞，勿用有攸往，利建侯。', xiangCi: '云雷屯，君子以经纶。', fortune: '中' }],
  [20, { name: '山水蒙', guaCi: '亨。匪我求童蒙，童蒙求我。初噬告，再三渎，渎则不告。利贞。', xiangCi: '山下出泉，蒙；君子以果行育德。', fortune: '中' }],
  [21, { name: '火水未济', guaCi: '亨，小狐汔济，濡其尾，无攸利。', xiangCi: '火在水上，未济；君子以慎辨物居方。', fortune: '中' }],
  [23, { name: '天水讼', guaCi: '有孚，窒惕，中吉，终凶。利见大人，不利涉大川。', xiangCi: '天与水违行，讼；君子以作事谋始。', fortune: '中' }],
  [25, { name: '泽雷随', guaCi: '元亨利贞，无咎。', xiangCi: '泽中有雷，随；君子以向晦入宴息。', fortune: '大吉' }],
  [31, { name: '天风姤', guaCi: '女壮，勿用取女。', xiangCi: '天下有风，姤；后以施命诰四方。', fortune: '小凶' }],
  [32, { name: '地雷复', guaCi: '亨。出入无疾，朋来无咎。反复其道，七日来复，利有攸往。', xiangCi: '雷在地中，复；先王以至日闭关，商旅不行，后不省方。', fortune: '吉' }],
  [34, { name: '水雷屯', guaCi: '元亨利贞，勿用有攸往，利建侯。', xiangCi: '云雷屯，君子以经纶。', fortune: '中' }],
  [38, { name: '山风蛊', guaCi: '元亨，利涉大川。先甲三日，后甲三日。', xiangCi: '山下有风，蛊；君子以振民育德。', fortune: '吉' }],
  [40, { name: '地火明夷', guaCi: '利艰贞。', xiangCi: '明入地中，明夷；君子以莅众，用晦而明。', fortune: '中' }],
  [41, { name: '火雷噬嗑', guaCi: '亨，利用狱。', xiangCi: '雷电噬嗑，先王以明罚敕法。', fortune: '吉' }],
  [42, { name: '水火既济', guaCi: '亨小，利贞，初吉终乱。', xiangCi: '水在火上，既济；君子以思患而豫防之。', fortune: '吉' }],
  [43, { name: '风火家人', guaCi: '利女贞。', xiangCi: '风自火出，家人；君子以言有物，而行有恒。', fortune: '吉' }],
  [47, { name: '火天大有', guaCi: '元亨。', xiangCi: '火在天上，大有；君子以遏恶扬善，顺天休命。', fortune: '大吉' }],
  [48, { name: '地泽临', guaCi: '元亨利贞，至于八月有凶。', xiangCi: '泽上有地，临；君子以教思无穷，容保民无疆。', fortune: '吉' }],
  [53, { name: '火泽睽', guaCi: '小事吉。', xiangCi: '上火下泽，睽；君子以同而异。', fortune: '小吉' }],
  [55, { name: '天泽履', guaCi: '履虎尾，不咥人，亨。', xiangCi: '上天下泽，履；君子以辩上下，定民志。', fortune: '吉' }],
  [56, { name: '地天泰', guaCi: '小往大来，吉亨。', xiangCi: '天地交，泰；后以财成天地之道，辅相天地之宜，以左右民。', fortune: '大吉' }],
  [58, { name: '水天需', guaCi: '有孚，光亨，贞吉。利涉大川。', xiangCi: '云上于天，需；君子以饮食宴乐。', fortune: '吉' }],
  [59, { name: '风天小畜', guaCi: '亨。密云不雨，自我西郊。', xiangCi: '风行天上，小畜；君子以懿文德。', fortune: '吉' }],
  [60, { name: '雷天大壮', guaCi: '利贞。', xiangCi: '雷在天上，大壮；君子以非礼勿履。', fortune: '吉' }],
  [61, { name: '天火同人', guaCi: '同人于野，亨。利涉大川，利君子贞。', xiangCi: '天与火，同人；君子以类族辨物。', fortune: '吉' }],
  [62, { name: '泽天夬', guaCi: '扬于王庭，孚号有厉，告自邑，不利即戎，利有攸往。', xiangCi: '泽上于天，夬；君子以施禄及下，居德则忌。', fortune: '吉' }],
  [63, { name: '乾为天', guaCi: '元亨利贞。', xiangCi: '天行健，君子以自强不息。', fortune: '大吉' }],
];

export const hexagramMap = new Map<number, Hexagram>(hexagramsData);

export function getHexagramByBinary(binary: string): Hexagram | undefined {
  if (binary.length !== 6 || !/^[01]+$/.test(binary)) {
    return undefined;
  }
  const index = parseInt(binary, 2);
  return hexagramMap.get(index);
}
