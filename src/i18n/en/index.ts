/**
 * English, looked up by the Swahili text exactly as it is written in t().
 *
 * One file per area of the app, merged here. `data` holds values that are
 * stored rather than written in code — expense categories, default
 * descriptions — for tData().
 */

import app from './app';
import auth from './auth';
import common from './common';
import data from './data';
import products from './products';
import sales from './sales';
import settings from './settings';
import vsmart from './vsmart';

const EN: Record<string, string> = {
  ...data,
  ...vsmart,
  ...products,
  ...sales,
  ...app,
  ...settings,
  ...auth,
  ...common,
};

export default EN;
