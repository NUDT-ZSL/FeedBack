import { EnvironmentManager } from './environment';
import { CoralManager } from './coral';
import { FishManager } from './fish';
import { CameraRig } from './cameraRig';
import {
  DEFAULT_WATER_PARAMS,
  HUDDocumentLike,
  formatTemperature,
  setHUDField,
} from './hud';

/**
 * Cross-module reset chain, extracted from main.ts so it can be verified
 * headlessly: corals regenerate first, fish schools re-form around the new
 * coral cluster centers, water parameters return to defaults and the camera
 * rig goes back to its initial pose. Order matters: fish reset must happen
 * after coral reset because it consumes the fresh cluster centers.
 */
export function resetReef(
  environment: EnvironmentManager,
  coralManager: CoralManager,
  fishManager: FishManager,
  cameraRig: CameraRig,
  doc?: HUDDocumentLike
): void {
  coralManager.reset();
  fishManager.reset(coralManager.getClusterCenters());

  environment.setTemperature(DEFAULT_WATER_PARAMS.temperature);
  environment.setLightIntensity(DEFAULT_WATER_PARAMS.lightIntensity);
  environment.setTurbidity(DEFAULT_WATER_PARAMS.turbidity);

  if (doc) {
    setHUDField(doc, 'water-temp', formatTemperature(DEFAULT_WATER_PARAMS.temperature));
  }

  cameraRig.reset();
}
