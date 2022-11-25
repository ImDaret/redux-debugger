# REDUX

## 前言

本文主要带着大家分析 redux 源码的主流程，适合有一定 redux 使用基础的人阅读，主要分为以下模块

- [REDUX](#redux)
  - [前言](#前言)
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

那既然 redux 要求 reducer 要求是一个纯函数，那我如果想调用接口或者从浏览器缓存读数据这些操作具有副作用的操作应该写在哪？幸好 redux 提供了 applyMiddleware 这个 api，它以中间件的设计模式，供用户增强自己的 dispatch,著名的 redux-thunk、redux-saga 就是 redux 中间件

```ts
export default function applyMiddleware(
  ...middlewares: Middleware[]
): StoreEnhancer<any> {
  // 返回一个createStore, 增强了dispatch
  return (createStore: StoreEnhancerStoreCreator) =>
    <S, A extends AnyAction>(
      reducer: Reducer<S, A>,
      preloadedState?: PreloadedState<S>
    ) => {
      // 创建一个store
      const store = createStore(reducer, preloadedState);

      const middlewareAPI: MiddlewareAPI = {
        getState: store.getState,
        dispatch: (action, ...args) => dispatch(action, ...args),
      };

      // 调用中间件，传入getState和dispatch
      const chain = middlewares.map((middleware) => middleware(middlewareAPI));

      // compose在下方的工具函数有介绍，这里就是第二次调用中间件，后一个中间件的next参数就是前一个中间件的返回值，直到调用store.dispatch
      dispatch = compose<typeof dispatch>(...chain)(store.dispatch);

      return {
        ...store,
        dispatch,
      };
    };
}
```

一起看下 redux-thunk 的源码，增强对中间件的理解

```ts
function createThunkMiddleware<
  State = any,
  BasicAction extends Action = AnyAction,
  ExtraThunkArg = undefined
>(extraArgument?: ExtraThunkArg) {
  const middleware: ThunkMiddleware<State, BasicAction, ExtraThunkArg> =
    ({ dispatch, getState }) =>
    (next) =>
    (action) => {
      // 如果action是一个函数则调用它，并把dispatch和getState传入，以便发起下一个action
      if (typeof action === "function") {
        return action(dispatch, getState, extraArgument);
      }

      // 否则，调用下一个中间件
      return next(action);
    };
  return middleware;
}
```

看到这，相信你不得不惊叹 redux 设计的巧妙，它要求 state 不能直接修改，只能通过 reducer 返回一个新的 state，reducer 又只能通过 dispatch 一个 action 触发，形成了单项数据流，但是这就要求了 reducer 必须是一个纯函数，所以又利用中间件模式。打造一个增强的 dispatch，让我们在触发真正的 dispatch 之前，可以处理一些副作用等等，让我们浅浅画个流程图，来理解一下单项数据流

[![流程](imgs/process.png)](https://github.com/ImDaret/redux-debugger/blob/main/imgs/process.png)

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

redux 写法如此繁琐，也无法和 ts 很好配合，然后其 immutable 的核心和 context 结合还有性能问题，它是如何在众多 react 状态管理库中脱颖而出的呢？我觉得最关键的就是 redux 的哲学，借鉴 flux 的单项数据流的架构，使得调试和时间旅行变得非常容易，使用 immutable 使 state 只读，每次修改只能返回一个新的对象，降低了复杂度，另外它还利用类似 koa 的洋葱模型思想，可以传入中间件完成一些额外的事情，比如打印日志，处理副作用等，扩展性很好。

## FAQ

1. redux 使用场景

- 应用中管理状态变得十分复杂， redux 可以帮助你实现简单的可预测的状态管理
- 时间旅行，得益于 reducer 纯函数

2. redux 和 mobx 有什么不同

- 哲学不同，redux 是 immutable, mobx 是 mutable
- 特性不同，redux 支持时间旅行。mobx 支持计算属性
- 性能不同，mobx 的更新粒度比 redux 好一点
- 状态存储不同，mobx 中的状态分散在各个 store 中，redux 是在一颗 store 树中

3. redux 中间件是如何实现的

- 要求中间件必须是一个高阶函数
- 利用 compose 将这些高阶函数聚合起来，上一个高阶函数的参数就是下一个高阶函数，比如上一个高阶函数的参数叫做 next，当调用 next()时，就是执行了下一个高阶函数，直到最后的参数是 dispatch

4. connect 的原理（react-redux 库中）

- 将 connect 包裹的组件与 provider 提供的订阅器关联，在 provider 中会订阅 store 中 state 的变化，当 state 发生变化时，通知所有与之关联的组件 reRender
