# redux-debugger

## 源码流程

## 工具方法

- 判断一个对象是否是简单对象

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

## 设计方法

- currentListener & nextListener 保证订阅只在下一次 dispatch 生效

订阅时`push`进 nextListeners

```ts
function subscribe(listener: () => void) {
  // ...抛错代码
  let isSubscribed = true;
  ensureCanMutateNextListeners(); // 保证不是同一个引用
  nextListeners.push(listener);
  return function unsubscribe() {
    if (!isSubscribed) {
      return;
    }
    // ...抛错代码
    isSubscribed = false;
    ensureCanMutateNextListeners();
    const index = nextListeners.indexOf(listener);
    nextListeners.splice(index, 1);
    currentListeners = null;
  };
}
```

dispatch 时对 currentListener 赋值，并且触发订阅

```ts
function dispatch(action: A) {
  try {
    isDispatching = true;
    currentState = currentReducer(currentState, action); // 更新state
  } finally {
    isDispatching = false;
  }

  const listeners = (currentListeners = nextListeners); // 赋值并触发订阅
  for (let i = 0; i < listeners.length; i++) {
    const listener = listeners[i];
    listener();
  }

  return action;
}
```
