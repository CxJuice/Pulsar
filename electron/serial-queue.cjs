function createSerialQueue() {
  let tail = Promise.resolve();
  return action => {
    const result = tail.then(action, action);
    tail = result.catch(() => {});
    return result;
  };
}

module.exports = { createSerialQueue };
