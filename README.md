# REDUX

## 前言

本文主要带着大家分析 redux 源码的主流程，适合有一定 redux 使用基础的人阅读，主要分为以下模块

- [为什么诞生](#为什么诞生)
- [主流程](#主流程)
- [工具函数](#工具函数)
- [思考](#思考)
- [FAQ](#faq)

**注意事项：为了便于读者理解，源码只会截取部分，如果想要进一步了解，可在[此仓库](https://github.com/ImDaret/reduxSaga-debugger)的 index.html 中自行 debugger**

## 为什么诞生

随着单页应用的火爆，一个复杂的应用状态更新越来越难以预测，像 react、vue 的出现主要是屏蔽了对 DOM 的操作，但是没有教你怎么管理状态，而 redux 正是干这个的。

## 主流程

要使用 redux 首先要调用它的 createStore 方法，该方法返回一个 store 实例,这里面涵盖了 dispatch、getState、subscribe 等重要的 API 源码

```ts
export default function createStore<
  S,
  A extends Action,
  Ext = {},
  StateExt = never
>(
  reducer: Reducer<S, A>,
  preloadedState?: PreloadedState<S> | StoreEnhancer<Ext, StateExt>,
  enhancer?: StoreEnhancer<Ext, StateExt>
): Store<ExtendState<S, StateExt>, A, StateExt, Ext> & Ext {
  // 如果 存在enhancer则加强store，这也是applyMiddleware的入口
  if (typeof enhancer !== "undefined") {
    return enhancer(createStore)(
      reducer,
      preloadedState as PreloadedState<S>
    ) as Store<ExtendState<S, StateExt>, A, StateExt, Ext> & Ext;
  }

  // 初始化一些变量
  let currentReducer = reducer;
  let currentState = preloadedState as S;
  let currentListeners: (() => void)[] | null = [];
  let nextListeners = currentListeners;
  let isDispatching = false;

  // 获取状态的方法，利用必包直接把currentState返回
  function getState(): S {
    return currentState as S;
  }

  // 监听的注册方法，使用currentListeners和nextListeners保证监听只会在下一次dispatch时生效
  function subscribe(listener: () => void) {
    let isSubscribed = true;
    nextListeners.push(listener);

    return function unsubscribe() {
      if (!isSubscribed) {
        return;
      }

      isSubscribed = false;

      const index = nextListeners.indexOf(listener);
      nextListeners.splice(index, 1);
      currentListeners = null;
    };
  }

  // 很简单，调用currentReducer然后返回新的state赋值给currentState,顺便触发一下listeners中的监听
  function dispatch(action: A) {
    if (isDispatching) {
      throw new Error("Reducers may not dispatch actions.");
    }
    try {
      isDispatching = true;
      currentState = currentReducer(currentState, action);
    } finally {
      isDispatching = false;
    }
    const listeners = (currentListeners = nextListeners);
    for (let i = 0; i < listeners.length; i++) {
      const listener = listeners[i];
      listener();
    }

    return action;
  }

  // 初始化state
  dispatch({ type: ActionTypes.INIT } as A);

  // store实例
  const store = {
    dispatch: dispatch as Dispatch<A>,
    subscribe,
    getState,
  } as unknown as Store<ExtendState<S, StateExt>, A, StateExt, Ext> & Ext;
  return store;
}
```

看到这我们应该明白了，dispatch 一个 action 其实就是调用了我们注册时的 reducer,然后返回了一个新的 currentState，所以 redux 要求 reducer 必须是一个纯函数。那当我们应用复杂了之后，拆分 reducer 是必然的，所以 redux 提供了 combineReducers 方法来供你拆分后组合这些 reducer

```ts
export default function combineReducers(reducers: ReducersMapObject) {
  const reducerKeys = Object.keys(reducers);
  const finalReducers: ReducersMapObject = {};

  // finalReducers中所有的reducer都是function类型
  for (let i = 0; i < reducerKeys.length; i++) {
    const key = reducerKeys[i];

    if (typeof reducers[key] === "function") {
      finalReducers[key] = reducers[key];
    }
  }

  //其实就是过滤掉了不是function类型的reducer
  const finalReducerKeys = Object.keys(finalReducers);

  // 返回一个组合过的reducer
  return function combination(
    state: StateFromReducersMapObject<typeof reducers> = {},
    action: AnyAction
  ) {
    let hasChanged = false;
    const nextState: StateFromReducersMapObject<typeof reducers> = {};
    // 这里其实就是把每个reducer的state转换成一个大对象{[k: reducerKey]: reducerState}
    for (let i = 0; i < finalReducerKeys.length; i++) {
      const key = finalReducerKeys[i];
      const reducer = finalReducers[key];
      const previousStateForKey = state[key];
      const nextStateForKey = reducer(previousStateForKey, action);
      nextState[key] = nextStateForKey;
      hasChanged = hasChanged || nextStateForKey !== previousStateForKey;
    }
    hasChanged =
      hasChanged || finalReducerKeys.length !== Object.keys(state).length;

    // 改变的话就返回新的State，否则就返回初始化的state
    return hasChanged ? nextState : state;
  };
}
```

## 设计理念

单向数据流
[![流程](imgs/process.png)](https://github.com/ImDaret/redux-debugger/blob/main/imgs/process.png)

## 设计思路

### currentListener & nextListener 保证订阅只在下一次 dispatch 生效

订阅时`push`进 nextListeners

```ts
function subscribe(listener: () => void) {
  // ...抛错代码
  nextListeners.push(listener);
  return function unsubscribe() {
    nextListeners.splice(index, 1);
  };
}
```

dispatch 时对 currentListener 赋值，并且触发订阅

```ts
function dispatch(action: A) {
  // ....
  const listeners = (currentListeners = nextListeners); // 赋值并触发订阅
  for (let i = 0; i < listeners.length; i++) {
    const listener = listeners[i];
    listener();
  }

  return action;
}
```

### 中间件实现-洋葱模型

[![洋葱模型](imgs/onion.png)](https://github.com/ImDaret/redux-debugger/blob/main/imgs/onion.png)

```ts
// 假如我现在有两个中间件，middleware = [logger1, logger2]
// 由 compose 函数可知，logger1 的 next 参数为 logger2 的返回值，logger2 的 next参数为store.dispatch，如果有更多中间件，以此类推。注意：中间件只有执行 next 方法才会向下继续执行
// 所以调用 dispatch 就相当于经历了一层层的中间件，最终调用 store.dispatch(action)
const dispatch = compose(...middleware)(store.dispatch);
```

## 工具函数

- 判断一个对象是否是普通对象

```ts
function isPlainObject(obj: any): boolean {
  if (typeof obj !== "object" || obj === null) return false;

  let proto = obj;
  while (Object.getPrototypeOf(proto) !== null) {
    proto = Object.getPrototypeOf(proto);
  }

  return Object.getPrototypeOf(obj) === proto;
}
```

- 组合多个函数

```ts
function compose(...funcs: Function[]) {
  if (funcs.length === 0) {
    // infer the argument type so it is usable in inference down the line
    return <T>(arg: T) => arg;
  }

  if (funcs.length === 1) {
    return funcs[0];
  }

  return funcs.reduce(
    (a, b) =>
      (...args: any) =>
        a(b(...args))
  );
}
```

## 思考

## FAQ
