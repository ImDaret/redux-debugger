function logger1({dispatch, getState}) {
  return (next) => (action) => {
    console.log('before logger1', next, action)
    const res = next(action)
    console.log('after logger1', getState())
    return res
  }
}

function logger2({dispatch, getState}) {
  return (next) => (action) => {
    console.log('before logger2', next, action)
    const res = next(action)
    console.log('after logger2', getState())
    return res
  }
}