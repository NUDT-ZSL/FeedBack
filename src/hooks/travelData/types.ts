import type { TravelData } from '../../types';

export type DataUpdater = (prev: TravelData) => TravelData;

export type UpdateData = (updater: DataUpdater) => void;
