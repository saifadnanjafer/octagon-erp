import * as assets from './assets.mjs';
import * as reports from './reports.mjs';
import { registerGatedHandler, PHASE05_MODULE_FLAGS } from '../control_plane/phase05.mjs';

export { assets, reports };

const FLAG = PHASE05_MODULE_FLAGS.assets;

export function registerAssetActions(actionExecutor) {
  const gate = (actionId, handler) => registerGatedHandler(actionExecutor, actionId, handler, FLAG, 'Assets');

  gate('asset:category:create', assets.createCategory);
  gate('asset:create', assets.createAsset);
  gate('asset:acquire', assets.acquireAsset);
  gate('asset:capitalize', assets.capitalize);
  gate('asset:schedule:generate', assets.generateSchedule);
  gate('asset:depreciation:post', assets.postDepreciation);
  gate('asset:assign', assets.assignAsset);
  gate('asset:transfer', assets.transferAsset);
  gate('asset:warranty:register', assets.registerWarranty);
  gate('asset:suspend', assets.suspendAsset);
  gate('asset:reactivate', assets.reactivateAsset);
  gate('asset:dispose', assets.dispose);
  gate('asset:write_off', assets.writeOff);
  gate('asset:meter:record', assets.recordMeterReading);
}
