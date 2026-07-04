import {observable} from 'mobx';

export class Backend {
  private stateMap = observable.map<string, object>();
}
