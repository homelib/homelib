import {type IReactionDisposer, reaction} from 'mobx';

/** Calls `callback` whenever `condition` becomes true. */
export function whenever(
  condition: () => boolean,
  callback: () => void,
): IReactionDisposer {
  return reaction(
    condition,
    value => {
      if (value) {
        callback();
      }
    },
    {fireImmediately: true},
  );
}
