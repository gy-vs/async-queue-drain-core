/* eslint-disable no-new */
import EventEmitter from 'eventemitter3';
import test from 'ava';
import delay from 'delay';
import inRange from 'in-range';
import timeSpan from 'time-span';
import randomInt from 'random-int';
import pDefer from 'p-defer';
import PQueue from '../source/index.js';

const fixture = Symbol('fixture');

test('.add()', async t => {
	const queue = new PQueue();
	const promise = queue.add(async () => fixture);
	t.is(queue.size, 0);
	t.is(queue.pending, 1);
	t.is(await promise, fixture);
});

test('.add() - limited concurrency', async t => {
	const queue = new PQueue({concurrency: 2});
	const promise = queue.add(async () => fixture);
	const promise2 = queue.add(async () => {
		await delay(100);
		return fixture;
	});
	const promise3 = queue.add(async () => fixture);
	t.is(queue.size, 1);
	t.is(queue.pending, 2);
	t.is(await promise, fixture);
	t.is(await promise2, fixture);
	t.is(await promise3, fixture);
});

test('.add() - concurrency: 1', async t => {
	const input = [
		[10, 300],
		[20, 200],
		[30, 100],
	];

	const end = timeSpan();
	const queue = new PQueue({concurrency: 1});

	const mapper = async ([value, ms]: readonly number[]) => queue.add(async () => {
		await delay(ms!);
		return value!;
	});

	// eslint-disable-next-line unicorn/no-array-callback-reference
	t.deepEqual(await Promise.all(input.map(mapper)), [10, 20, 30]);
	t.true(inRange(end(), {start: 590, end: 650}));
});

test('.add() - concurrency: 5', async t => {
	const concurrency = 5;
	const queue = new PQueue({concurrency});
	let running = 0;

	const input = Array.from({length: 100}).fill(0).map(async () => queue.add(async () => {
		running++;
		t.true(running <= concurrency);
		t.true(queue.pending <= concurrency);
		await delay(randomInt(30, 200));
		running--;
	}));

	await Promise.all(input);
});

test('.add() - update concurrency', async t => {
	let concurrency = 5;
	const queue = new PQueue({concurrency});
	let running = 0;

	const input = Array.from({length: 100}).fill(0).map(async (_value, index) => queue.add(async () => {
		running++;

		t.true(running <= concurrency);
		t.true(queue.pending <= concurrency);

		await delay(randomInt(30, 200));
		running--;

		if (index % 30 === 0) {
			queue.concurrency = --concurrency;
			t.is(queue.concurrency, concurrency);
		}
	}));

	await Promise.all(input);
});

test('.add() - priority', async t => {
	const result: number[] = [];
	const queue = new PQueue({concurrency: 1});
	queue.add(async () => result.push(1), {priority: 1});
	queue.add(async () => result.push(0), {priority: 0});
	queue.add(async () => result.push(1), {priority: 1});
	queue.add(async () => result.push(2), {priority: 1});
	queue.add(async () => result.push(3), {priority: 2});
	queue.add(async () => result.push(0), {priority: -1});
	await queue.onEmpty();
	t.deepEqual(result, [1, 3, 1, 2, 0, 0]);
});

test('.sizeBy() - priority', async t => {
	const queue = new PQueue();
	queue.pause();
	queue.add(async () => 0, {priority: 1});
	queue.add(async () => 0, {priority: 0});
	queue.add(async () => 0, {priority: 1});
	t.is(queue.sizeBy({priority: 1}), 2);
	t.is(queue.sizeBy({priority: 0}), 1);
	queue.clear();
	await queue.onEmpty();
	t.is(queue.sizeBy({priority: 1}), 0);
	t.is(queue.sizeBy({priority: 0}), 0);
});

test('.add() - priority defaults to 0 when undefined', async t => {
	const result: string[] = [];
	const queue = new PQueue({concurrency: 1});
	queue.add(async () => result.push('first'), {priority: undefined});
	queue.add(async () => result.push('second'), {priority: undefined});
	queue.add(async () => result.push('priority'), {priority: 1});
	queue.add(async () => result.push('third'), {priority: undefined});
	await queue.onEmpty();
	t.deepEqual(result, ['first', 'priority', 'second', 'third']);
});

test('.add() - timeout without throwing', async t => {
	const result: string[] = [];
	const queue = new PQueue({timeout: 300, throwOnTimeout: false});
	queue.add(async () => {
		await delay(400);
		result.push('🐌');
	});
	queue.add(async () => {
		await delay(250);
		result.push('🦆');
	});
	queue.add(async () => {
		await delay(310);
		result.push('🐢');
	});
	queue.add(async () => {
		await delay(100);
		result.push('🐅');
	});
	queue.add(async () => {
		result.push('⚡️');
	});
	await queue.onIdle();
	t.deepEqual(result, ['⚡️', '🐅', '🦆']);
});

test.failing('.add() - timeout with throwing', async t => {
	const result: string[] = [];
	const queue = new PQueue({timeout: 300, throwOnTimeout: true});
	await t.throwsAsync(queue.add(async () => {
		await delay(400);
		result.push('🐌');
	}));
	queue.add(async () => {
		await delay(200);
		result.push('🦆');
	});
	await queue.onIdle();
	t.deepEqual(result, ['🦆']);
});

test('.add() - change timeout in between', async t => {
	const result: string[] = [];
	const initialTimeout = 50;
	const newTimeout = 200;
	const queue = new PQueue({timeout: initialTimeout, throwOnTimeout: false, concurrency: 2});
	queue.add(async () => {
		const {timeout} = queue;
		t.deepEqual(timeout, initialTimeout);
		await delay(300);
		result.push('🐌');
	});
	queue.timeout = newTimeout;
	queue.add(async () => {
		const {timeout} = queue;
		t.deepEqual(timeout, newTimeout);
		await delay(100);
		result.push('🐅');
	});
	await queue.onIdle();
	t.deepEqual(result, ['🐅']);
});

test('.onEmpty()', async t => {
	const queue = new PQueue({concurrency: 1});

	queue.add(async () => 0);
	queue.add(async () => 0);
	t.is(queue.size, 1);
	t.is(queue.pending, 1);
	await queue.onEmpty();
	t.is(queue.size, 0);

	queue.add(async () => 0);
	queue.add(async () => 0);
	t.is(queue.size, 1);
	t.is(queue.pending, 1);
	await queue.onEmpty();
	t.is(queue.size, 0);

	// Test an empty queue
	await queue.onEmpty();
	t.is(queue.size, 0);
});

test('.onIdle()', async t => {
	const queue = new PQueue({concurrency: 2});

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	t.is(queue.size, 1);
	t.is(queue.pending, 2);
	await queue.onIdle();
	t.is(queue.size, 0);
	t.is(queue.pending, 0);

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	t.is(queue.size, 1);
	t.is(queue.pending, 2);
	await queue.onIdle();
	t.is(queue.size, 0);
	t.is(queue.pending, 0);
});

test('.onSizeLessThan()', async t => {
	const queue = new PQueue({concurrency: 1});

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));

	await queue.onSizeLessThan(4);
	t.is(queue.size, 3);
	t.is(queue.pending, 1);

	await queue.onSizeLessThan(2);
	t.is(queue.size, 1);
	t.is(queue.pending, 1);

	await queue.onSizeLessThan(10);
	t.is(queue.size, 1);
	t.is(queue.pending, 1);

	await queue.onSizeLessThan(1);
	t.is(queue.size, 0);
	t.is(queue.pending, 1);
});

test('.onIdle() - no pending', async t => {
	const queue = new PQueue();
	t.is(queue.size, 0);
	t.is(queue.pending, 0);

	// eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
	t.is(await queue.onIdle(), undefined);
});

test('.clear()', t => {
	const queue = new PQueue({concurrency: 2});
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	t.is(queue.size, 4);
	t.is(queue.pending, 2);
	queue.clear();
	t.is(queue.size, 0);
});

test('.addAll()', async t => {
	const queue = new PQueue();
	const fn = async (): Promise<symbol> => fixture;
	const functions = [fn, fn];
	const promise = queue.addAll(functions);
	t.is(queue.size, 0);
	t.is(queue.pending, 2);
	t.deepEqual(await promise, [fixture, fixture]);
});

test('enforce number in options.concurrency', t => {
	t.throws(
		() => {
			new PQueue({concurrency: 0});
		},
		{instanceOf: TypeError},
	);

	t.throws(
		() => {
			new PQueue({concurrency: undefined});
		},
		{instanceOf: TypeError},
	);

	t.notThrows(() => {
		new PQueue({concurrency: 1});
	});

	t.notThrows(() => {
		new PQueue({concurrency: 10});
	});

	t.notThrows(() => {
		new PQueue({concurrency: Number.POSITIVE_INFINITY});
	});
});

test('enforce number in queue.concurrency', t => {
	t.throws(
		() => {
			(new PQueue()).concurrency = 0;
		},
		{instanceOf: TypeError},
	);

	t.throws(
		() => {
			// @ts-expect-error Testing
			(new PQueue()).concurrency = undefined;
		},
		{instanceOf: TypeError},
	);

	t.notThrows(() => {
		(new PQueue()).concurrency = 1;
	});

	t.notThrows(() => {
		(new PQueue()).concurrency = 10;
	});

	t.notThrows(() => {
		(new PQueue()).concurrency = Number.POSITIVE_INFINITY;
	});
});

test('enforce number in options.intervalCap', t => {
	t.throws(
		() => {
			new PQueue({intervalCap: 0});
		},
		{instanceOf: TypeError},
	);

	t.throws(
		() => {
			new PQueue({intervalCap: undefined});
		},
		{instanceOf: TypeError},
	);

	t.notThrows(() => {
		new PQueue({intervalCap: 1});
	});

	t.notThrows(() => {
		new PQueue({intervalCap: 10});
	});

	t.notThrows(() => {
		new PQueue({intervalCap: Number.POSITIVE_INFINITY});
	});
});

test('enforce finite in options.interval', t => {
	t.throws(
		() => {
			new PQueue({interval: -1});
		},
		{instanceOf: TypeError},
	);

	t.throws(
		() => {
			new PQueue({interval: undefined});
		},
		{instanceOf: TypeError},
	);

	t.throws(() => {
		new PQueue({interval: Number.POSITIVE_INFINITY});
	});

	t.notThrows(() => {
		new PQueue({interval: 0});
	});

	t.notThrows(() => {
		new PQueue({interval: 10});
	});

	t.throws(() => {
		new PQueue({interval: Number.POSITIVE_INFINITY});
	});
});

test('autoStart: false', t => {
	const queue = new PQueue({concurrency: 2, autoStart: false});

	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	t.is(queue.size, 4);
	t.is(queue.pending, 0);
	t.is(queue.isPaused, true);

	queue.start();
	t.is(queue.size, 2);
	t.is(queue.pending, 2);
	t.is(queue.isPaused, false);

	queue.clear();
	t.is(queue.size, 0);
});

test('.start() - return this', async t => {
	const queue = new PQueue({concurrency: 2, autoStart: false});

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	t.is(queue.size, 3);
	t.is(queue.pending, 0);
	await queue.start().onIdle();
	t.is(queue.size, 0);
	t.is(queue.pending, 0);
});

test('.start() - not paused', t => {
	const queue = new PQueue();

	t.falsy(queue.isPaused);

	queue.start();

	t.falsy(queue.isPaused);
});

test('.pause()', t => {
	const queue = new PQueue({concurrency: 2});

	queue.pause();
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	t.is(queue.size, 5);
	t.is(queue.pending, 0);
	t.is(queue.isPaused, true);

	queue.start();
	t.is(queue.size, 3);
	t.is(queue.pending, 2);
	t.is(queue.isPaused, false);

	queue.add(async () => delay(20_000));
	queue.pause();
	t.is(queue.size, 4);
	t.is(queue.pending, 2);
	t.is(queue.isPaused, true);

	queue.start();
	t.is(queue.size, 4);
	t.is(queue.pending, 2);
	t.is(queue.isPaused, false);

	queue.clear();
	t.is(queue.size, 0);
});

test('.add() sync/async mixed tasks', async t => {
	const queue = new PQueue({concurrency: 1});
	queue.add(() => 'sync 1');
	queue.add(async () => delay(1000));
	queue.add(() => 'sync 2');
	queue.add(() => fixture);
	t.is(queue.size, 3);
	t.is(queue.pending, 1);
	await queue.onIdle();
	t.is(queue.size, 0);
	t.is(queue.pending, 0);
});

test.failing('.add() - handle task throwing error', async t => {
	const queue = new PQueue({concurrency: 1});

	queue.add(() => 'sync 1');
	await t.throwsAsync(
		queue.add(
			() => {
				throw new Error('broken');
			},
		),
		{message: 'broken'},
	);
	queue.add(() => 'sync 2');

	t.is(queue.size, 2);

	await queue.onIdle();
});

test('.add() - handle task promise failure', async t => {
	const queue = new PQueue({concurrency: 1});

	await t.throwsAsync(
		queue.add(
			async () => {
				throw new Error('broken');
			},
		),
		{message: 'broken'},
	);

	queue.add(() => 'task #1');

	t.is(queue.pending, 1);

	await queue.onIdle();

	t.is(queue.pending, 0);
});

test('.addAll() sync/async mixed tasks', async t => {
	const queue = new PQueue();

	const functions: Array<() => (string | Promise<void> | Promise<unknown>)> = [
		() => 'sync 1',
		async () => delay(2000),
		() => 'sync 2',
		async () => fixture,
	];

	const promise = queue.addAll(functions);

	t.is(queue.size, 0);
	t.is(queue.pending, 4);
	t.deepEqual(await promise, ['sync 1', undefined, 'sync 2', fixture]);
});

test('should resolve empty when size is zero', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});

	// It should take 1 seconds to resolve all tasks
	for (let index = 0; index < 100; index++) {
		queue.add(async () => delay(10));
	}

	(async () => {
		await queue.onEmpty();
		t.is(queue.size, 0);
	})();

	queue.start();

	// Pause at 0.5 second
	setTimeout(
		async () => {
			queue.pause();
			await delay(10);
			queue.start();
		},
		500,
	);

	await queue.onIdle();
});

test('.add() - throttled', async t => {
	const result: number[] = [];
	const queue = new PQueue({
		intervalCap: 1,
		interval: 500,
		autoStart: false,
	});
	queue.add(async () => result.push(1));
	queue.start();
	await delay(250);
	queue.add(async () => result.push(2));
	t.deepEqual(result, [1]);
	await delay(300);
	t.deepEqual(result, [1, 2]);
});

test('.add() - throttled, carryoverConcurrencyCount false', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		intervalCap: 1,
		carryoverConcurrencyCount: false,
		interval: 500,
		autoStart: false,
	});

	const values = [0, 1];
	for (const value of values) {
		queue.add(async () => {
			await delay(600);
			result.push(value);
		});
	}

	queue.start();

	(async () => {
		await delay(550);
		t.is(queue.pending, 2);
		t.deepEqual(result, []);
	})();

	(async () => {
		await delay(650);
		t.is(queue.pending, 1);
		t.deepEqual(result, [0]);
	})();

	await delay(1250);
	t.deepEqual(result, values);
});

test('.add() - throttled, carryoverConcurrencyCount true', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		carryoverConcurrencyCount: true,
		intervalCap: 1,
		interval: 500,
		autoStart: false,
	});

	const values = [0, 1];
	for (const value of values) {
		queue.add(async () => {
			await delay(600);
			result.push(value);
		});
	}

	queue.start();

	(async () => {
		await delay(100);
		t.deepEqual(result, []);
		t.is(queue.pending, 1);
	})();

	(async () => {
		await delay(550);
		t.deepEqual(result, []);
		t.is(queue.pending, 1);
	})();

	(async () => {
		await delay(650);
		t.deepEqual(result, [0]);
		t.is(queue.pending, 0);
	})();

	(async () => {
		await delay(1550);
		t.deepEqual(result, [0]);
	})();

	await delay(1650);
	t.deepEqual(result, values);
});

test('.add() - throttled 10, concurrency 5', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		concurrency: 5,
		intervalCap: 10,
		interval: 1000,
		autoStart: false,
	});

	const firstValue = [...Array.from({length: 5}).keys()];
	const secondValue = [...Array.from({length: 10}).keys()];
	const thirdValue = [...Array.from({length: 13}).keys()];

	for (const value of thirdValue) {
		queue.add(async () => {
			await delay(300);
			result.push(value);
		});
	}

	queue.start();

	t.deepEqual(result, []);

	(async () => {
		await delay(400);
		t.deepEqual(result, firstValue);
		t.is(queue.pending, 5);
	})();

	(async () => {
		await delay(700);
		t.deepEqual(result, secondValue);
	})();

	(async () => {
		await delay(1200);
		t.is(queue.pending, 3);
		t.deepEqual(result, secondValue);
	})();

	await delay(1400);
	t.deepEqual(result, thirdValue);
});

test('.add() - throttled finish and resume', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		concurrency: 1,
		intervalCap: 2,
		interval: 2000,
		autoStart: false,
	});

	const values = [0, 1];
	const firstValue = [0, 1];
	const secondValue = [0, 1, 2];

	for (const value of values) {
		queue.add(async () => {
			await delay(100);
			result.push(value);
		});
	}

	queue.start();

	(async () => {
		await delay(1000);
		t.deepEqual(result, firstValue);

		queue.add(async () => {
			await delay(100);
			result.push(2);
		});
	})();

	(async () => {
		await delay(1500);
		t.deepEqual(result, firstValue);
	})();

	await delay(2200);
	t.deepEqual(result, secondValue);
});

test('pause should work when throttled', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		concurrency: 2,
		intervalCap: 2,
		interval: 1000,
		autoStart: false,
	});

	const values = [0, 1, 2, 3];
	const firstValue = [0, 1];
	const secondValue = [0, 1, 2, 3];

	for (const value of values) {
		queue.add(async () => {
			await delay(100);
			result.push(value);
		});
	}

	queue.start();

	(async () => {
		await delay(300);
		t.deepEqual(result, firstValue);
	})();

	(async () => {
		await delay(600);
		queue.pause();
	})();

	(async () => {
		await delay(1400);
		t.deepEqual(result, firstValue);
	})();

	(async () => {
		await delay(1500);
		queue.start();
	})();

	(async () => {
		await delay(2200);
		t.deepEqual(result, secondValue);
	})();

	await delay(2500);
});

test('clear interval on pause', async t => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 1,
	});

	queue.add(() => {
		queue.pause();
	});

	queue.add(() => 'task #1');

	await delay(300);

	t.is(queue.size, 1);
});

test('should be an event emitter', t => {
	const queue = new PQueue();
	t.true(queue instanceof EventEmitter);
});

test('should emit active event per item', async t => {
	const items = [0, 1, 2, 3, 4];
	const queue = new PQueue();

	let eventCount = 0;
	queue.on('active', () => {
		eventCount++;
	});

	for (const item of items) {
		queue.add(() => item);
	}

	await queue.onIdle();

	t.is(eventCount, items.length);
});

test('should emit idle event when idle', async t => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('idle', () => {
		timesCalled++;
	});

	const job1 = queue.add(async () => delay(100));
	const job2 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 1);
	t.is(timesCalled, 0);

	await job1;

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 0);

	await job2;

	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 1);

	const job3 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 1);

	await job3;
	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 2);
});

test('should emit empty event when empty', async t => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('empty', () => {
		timesCalled++;
	});

	const {resolve: resolveJob1, promise: job1Promise} = pDefer();
	const {resolve: resolveJob2, promise: job2Promise} = pDefer();

	const job1 = queue.add(async () => job1Promise);
	const job2 = queue.add(async () => job2Promise);
	t.is(queue.size, 1);
	t.is(queue.pending, 1);
	t.is(timesCalled, 0);

	resolveJob1();
	await job1;

	t.is(queue.size, 0);
	t.is(queue.pending, 1);
	t.is(timesCalled, 0);

	resolveJob2();
	await job2;

	t.is(queue.size, 0);
	t.is(queue.pending, 0);
	t.is(timesCalled, 1);
});

test('should emit add event when adding task', async t => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('add', () => {
		timesCalled++;
	});

	const job1 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 1);

	const job2 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 1);
	t.is(timesCalled, 2);

	await job1;

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 2);

	await job2;

	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 2);

	const job3 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 3);

	await job3;
	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 3);
});

test('should emit next event when completing task', async t => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('next', () => {
		timesCalled++;
	});

	const job1 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 0);

	const job2 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 1);
	t.is(timesCalled, 0);

	await job1;

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 1);

	await job2;

	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 2);

	const job3 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 2);

	await job3;
	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 3);
});

test('should emit completed / error events', async t => {
	const queue = new PQueue({concurrency: 1});

	let errorEvents = 0;
	let completedEvents = 0;
	queue.on('error', () => {
		errorEvents++;
	});
	queue.on('completed', () => {
		completedEvents++;
	});

	const job1 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(errorEvents, 0);
	t.is(completedEvents, 0);

	const job2 = queue.add(async () => {
		await delay(1);
		throw new Error('failure');
	});

	t.is(queue.pending, 1);
	t.is(queue.size, 1);
	t.is(errorEvents, 0);
	t.is(completedEvents, 0);

	await job1;

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(errorEvents, 0);
	t.is(completedEvents, 1);

	await t.throwsAsync(job2);

	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(errorEvents, 1);
	t.is(completedEvents, 1);

	const job3 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(errorEvents, 1);
	t.is(completedEvents, 1);

	await job3;
	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(errorEvents, 1);
	t.is(completedEvents, 2);
});

test('should verify timeout overrides passed to add', async t => {
	const queue = new PQueue({timeout: 200, throwOnTimeout: true});

	await t.throwsAsync(queue.add(async () => {
		await delay(400);
	}));

	await t.notThrowsAsync(queue.add(async () => {
		await delay(400);
	}, {throwOnTimeout: false}));

	await t.notThrowsAsync(queue.add(async () => {
		await delay(400);
	}, {timeout: 600}));

	await t.notThrowsAsync(queue.add(async () => {
		await delay(100);
	}));

	await t.throwsAsync(queue.add(async () => {
		await delay(100);
	}, {timeout: 50}));

	await queue.onIdle();
});

test('should skip an aborted job', async t => {
	const queue = new PQueue();
	const controller = new AbortController();

	controller.abort();
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	await t.throwsAsync(queue.add(() => {}, {signal: controller.signal}), {
		instanceOf: DOMException,
	});
});

test('should pass AbortSignal instance to job', async t => {
	const queue = new PQueue();
	const controller = new AbortController();

	await queue.add(async ({signal}) => {
		t.is(controller.signal, signal!);
	}, {signal: controller.signal});
});

test('aborted jobs do not use interval cap', async t => {
	const queue = new PQueue({
		concurrency: 1,
		interval: 100,
		intervalCap: 1,
	});

	const controller = new AbortController();

	for (let index = 0; index < 5; index++) {
		queue.add(() => {}, {signal: controller.signal}).catch(() => {}); // eslint-disable-line @typescript-eslint/no-empty-function
	}

	queue.add(() => {}); // eslint-disable-line @typescript-eslint/no-empty-function

	controller.abort();
	await delay(150);
	t.is(queue.size, 0);
});

test('aborting multiple jobs at the same time', async t => {
	const queue = new PQueue({concurrency: 1});

	const controller1 = new AbortController();
	const controller2 = new AbortController();

	const task1 = queue.add(async () => new Promise(() => {}), {signal: controller1.signal}); // eslint-disable-line @typescript-eslint/no-empty-function
	const task2 = queue.add(async () => new Promise(() => {}), {signal: controller2.signal}); // eslint-disable-line @typescript-eslint/no-empty-function

	setTimeout(() => {
		controller1.abort();
		controller2.abort();
	}, 0);

	await t.throwsAsync(task1, {instanceOf: DOMException});
	await t.throwsAsync(task2, {instanceOf: DOMException});
	t.like(queue, {size: 0, pending: 0});
});

test('pending promises counted fast enough', async t => {
	const queue = new PQueue({autoStart: false, concurrency: 2});

	let hasThirdRun = false;

	queue.add(async () => delay(1000));
	queue.add(async () => delay(1000));
	queue.add(async () => {
		hasThirdRun = true;
	});

	queue.start();

	await delay(100);

	t.false(hasThirdRun);
});

test('pending promises with abortions counted fast enough', async t => {
	const queue = new PQueue({autoStart: false, concurrency: 2});

	const controller = new AbortController();

	let hasThirdRun = false;

	queue.add(async () => delay(1000));
	queue.add(async () => delay(1000));
	const abortedPromise = queue.add(async () => delay(1000), {signal: controller.signal});
	queue.add(async () => {
		hasThirdRun = true;
	});

	controller.abort();
	queue.start();

	await delay(100);

	t.false(hasThirdRun);
	await t.throwsAsync(abortedPromise, {instanceOf: DOMException});

	await delay(100);

	t.true(hasThirdRun);
});

test('intervalCap', async t => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 2,
	});

	let hasThirdRun = false;

	queue.add(async () => '🧜‍♂️');
	queue.add(async () => '🧜‍♂️');
	queue.add(async () => {
		hasThirdRun = true;
	});

	await delay(100);

	t.false(hasThirdRun);

	await delay(1500);

	t.true(hasThirdRun);
});

test('consumed interval is remembered between idle states', async t => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 2,
	});

	await queue.add(async () => '🧜‍♂️');

	await delay(300);

	let hasThirdRun = false;

	queue.add(async () => {
		await delay(200);
		return '🧜‍♂️';
	});
	queue.add(async () => {
		hasThirdRun = true;
	});

	await delay(50);

	t.false(hasThirdRun);

	await delay(1500);

	t.true(hasThirdRun);
});

test('consumed interval is updated on time, even between idle states', async t => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 2,
	});

	await queue.addAll([
		async () => {
			await delay(500);
			return '🧜‍♂️';
		},
		async () => {
			await delay(500);
			return '🧜‍♂️';
		},
	]);

	await delay(600);

	let hasThirdRun = false;

	queue.add(async () => {
		hasThirdRun = true;
	});

	await delay(50);

	t.true(hasThirdRun);
});

test('.setPriority() - execute a promise before planned', async t => {
	const result: string[] = [];
	const queue = new PQueue({concurrency: 1});
	queue.add(async () => {
		await delay(400);
		result.push('🐌');
	}, {id: '🐌'});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	}, {id: '🦆'});
	queue.add(async () => {
		await delay(400);
		result.push('🐢');
	}, {id: '🐢'});
	queue.setPriority('🐢', 1);
	await queue.onIdle();
	t.deepEqual(result, ['🐌', '🐢', '🦆']);
});

test('interval should be maintained when using await between adds (issue #182)', async t => {
	const queue = new PQueue({
		intervalCap: 1,
		interval: 100,
	});

	const timestamps: number[] = [];

	// Add first 3 tasks without await
	queue.add(() => {
		timestamps.push(Date.now());
		return 'task1';
	});
	queue.add(() => {
		timestamps.push(Date.now());
		return 'task2';
	});
	queue.add(() => {
		timestamps.push(Date.now());
		return 'task3';
	});

	// Add task 4 with await
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task4';
	});

	// Add task 5 with await - this should still respect interval
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task5';
	});

	// Add task 6 with await
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task6';
	});

	// Check intervals between tasks
	for (let index = 1; index < timestamps.length; index++) {
		const interval = timestamps[index] - timestamps[index - 1];
		// Allow 10ms tolerance for timing
		t.true(interval >= 90, `Interval between task ${index} and ${index + 1} was ${interval}ms, expected >= 90ms`);
	}
});

test('interval maintained when queue becomes empty multiple times', async t => {
	const queue = new PQueue({
		intervalCap: 1,
		interval: 100,
	});

	const timestamps: number[] = [];

	// First batch
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task1';
	});
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task2';
	});

	// Queue is empty, wait a bit
	await delay(50);

	// Second batch - should still respect interval from task 2
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task3';
	});
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task4';
	});

	// Check all intervals
	for (let index = 1; index < timestamps.length; index++) {
		const interval = timestamps[index] - timestamps[index - 1];
		t.true(interval >= 90, `Interval between task ${index} and ${index + 1} was ${interval}ms, expected >= 90ms`);
	}
});

test('interval reset after long idle period', async t => {
	const queue = new PQueue({
		intervalCap: 1,
		interval: 100,
	});

	const timestamps: number[] = [];

	// Run first task
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task1';
	});

	// Wait much longer than interval
	await delay(250);

	// This task should run immediately since enough time has passed
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task2';
	});

	// But this one should wait for interval
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task3';
	});

	const interval1to2 = timestamps[1] - timestamps[0];
	const interval2to3 = timestamps[2] - timestamps[1];

	t.true(interval1to2 >= 240, `Task 2 ran after ${interval1to2}ms, expected >= 240ms`);
	t.true(interval2to3 >= 90, `Task 3 should respect interval: ${interval2to3}ms`);
});

test('interval with carryoverConcurrencyCount after queue empty', async t => {
	const queue = new PQueue({
		intervalCap: 1,
		interval: 100,
		carryoverConcurrencyCount: true,
	});

	const timestamps: number[] = [];

	// Run first task
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task1';
	});

	// Queue becomes empty
	t.is(queue.size, 0);
	t.is(queue.pending, 0);

	// Add new task - should respect interval
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task2';
	});

	const interval = timestamps[1] - timestamps[0];
	t.true(interval >= 90, `Interval was ${interval}ms, expected >= 90ms`);
});

test('.setPriority() - execute a promise after planned', async t => {
	const result: string[] = [];
	const queue = new PQueue({concurrency: 1});
	queue.add(async () => {
		await delay(400);
		result.push('🐌');
	}, {id: '🐌'});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	}, {id: '🦆'});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	}, {id: '🦆'});
	queue.add(async () => {
		await delay(400);
		result.push('🐢');
	}, {id: '🐢'});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	}, {id: '🦆'});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	}, {id: '🦆'});
	queue.setPriority('🐢', -1);
	await queue.onIdle();
	t.deepEqual(result, ['🐌', '🦆', '🦆', '🦆', '🦆', '🐢']);
});

test('.setPriority() - execute a promise before planned - concurrency 2', async t => {
	const result: string[] = [];
	const queue = new PQueue({concurrency: 2});
	queue.add(async () => {
		await delay(400);
		result.push('🐌');
	}, {id: '🐌'});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	}, {id: '🦆'});
	queue.add(async () => {
		await delay(400);
		result.push('🐢');
	}, {id: '🐢'});
	queue.add(async () => {
		await delay(400);
		result.push('⚡️');
	}, {id: '⚡️'});
	queue.setPriority('⚡️', 1);
	await queue.onIdle();
	t.deepEqual(result, ['🐌', '🦆', '⚡️', '🐢']);
});

test('.setPriority() - execute a promise before planned - concurrency 3', async t => {
	const result: string[] = [];
	const queue = new PQueue({concurrency: 3});
	queue.add(async () => {
		await delay(400);
		result.push('🐌');
	}, {id: '🐌'});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	}, {id: '🦆'});
	queue.add(async () => {
		await delay(400);
		result.push('🐢');
	}, {id: '🐢'});
	queue.add(async () => {
		await delay(400);
		result.push('⚡️');
	}, {id: '⚡️'});
	queue.add(async () => {
		await delay(400);
		result.push('🦀');
	}, {id: '🦀'});
	queue.setPriority('🦀', 1);
	await queue.onIdle();
	t.deepEqual(result, ['🐌', '🦆', '🐢', '🦀', '⚡️']);
});

test('.setPriority() - execute a multiple promise before planned, with variable priority', async t => {
	const result: string[] = [];
	const queue = new PQueue({concurrency: 2});
	queue.add(async () => {
		await delay(400);
		result.push('🐌');
	}, {id: '🐌'});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	}, {id: '🦆'});
	queue.add(async () => {
		await delay(400);
		result.push('🐢');
	}, {id: '🐢'});
	queue.add(async () => {
		await delay(400);
		result.push('⚡️');
	}, {id: '⚡️'});
	queue.add(async () => {
		await delay(400);
		result.push('🦀');
	}, {id: '🦀'});
	queue.setPriority('⚡️', 1);
	queue.setPriority('🦀', 2);
	await queue.onIdle();
	t.deepEqual(result, ['🐌', '🦆', '🦀', '⚡️', '🐢']);
});

test('.setPriority() - execute a promise before planned - concurrency 3 and unspecified `id`', async t => {
	const result: string[] = [];
	const queue = new PQueue({concurrency: 3});
	queue.add(async () => {
		await delay(400);
		result.push('🐌');
	});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	});
	queue.add(async () => {
		await delay(400);
		result.push('🐢');
	});
	queue.add(async () => {
		await delay(400);
		result.push('⚡️');
	});
	queue.add(async () => {
		await delay(400);
		result.push('🦀');
	});
	queue.setPriority('5', 1);
	await queue.onIdle();
	t.deepEqual(result, ['🐌', '🦆', '🐢', '🦀', '⚡️']);
});

test('process exits cleanly after interval tasks complete', async t => {
	const queue = new PQueue({
		concurrency: 100,
		intervalCap: 500,
		interval: 60 * 1000,
	});

	// Execute tasks that complete quickly with long interval
	const tasks = [];
	for (let index = 0; index < 4; index++) {
		tasks.push(queue.add(() => `result-${index}`));
	}

	await Promise.all(tasks);
	await queue.onIdle();

	// Test that no timers are hanging by checking process can exit naturally
	// This ensures both intervalId and timeoutId are cleared when idle
	t.pass();
});

test('intervalCap should be respected with high concurrency (issue #126)', async t => {
	const queue = new PQueue({
		concurrency: 5000,
		intervalCap: 1000,
		interval: 1000,
		carryoverConcurrencyCount: true,
	});

	const results: number[] = [];
	const startTime = Date.now();

	// Add 5000 tasks that complete immediately
	const promises = [];
	for (let index = 0; index < 5000; index++) {
		promises.push(queue.add(async () => {
			results.push(Date.now() - startTime);
		}));
	}

	await Promise.all(promises);

	// Check that no more than intervalCap tasks started in the first interval
	const firstInterval = results.filter(timestamp => timestamp < 1000);
	t.true(firstInterval.length <= 1000, `Expected ≤1000 tasks in first interval, got ${firstInterval.length}`);

	// Check that tasks actually completed (basic sanity check)
	t.is(results.length, 5000, 'All tasks should complete');
});

// Regression test for the call-stack overflow that happened when thousands of
// jobs sharing an AbortSignal were enqueued (concurrency limited) and the
// signal was aborted: each aborted job chained the next start from its
// `#next()`, nesting the whole run on a single stack.
test('mass abort does not overflow the stack and drains the queue', async t => {
	const queue = new PQueue({concurrency: 1});
	const controller = new AbortController();

	const count = 10_000;
	const promises = [];
	for (let index = 0; index < count; index++) {
		promises.push(queue.add(async () => new Promise(() => {}), {signal: controller.signal})); // eslint-disable-line @typescript-eslint/no-empty-function
	}

	controller.abort();

	const results = await Promise.allSettled(promises);
	t.is(results.filter(result => result.status === 'rejected').length, count);
	t.is(queue.size, 0);
	t.is(queue.pending, 0);
});

test('mass abort does not overflow with higher concurrency either', async t => {
	for (const concurrency of [2, 8, 64]) {
		const queue = new PQueue({concurrency});
		const controller = new AbortController();

		const count = 5000;
		const promises = [];
		for (let index = 0; index < count; index++) {
			promises.push(queue.add(async () => new Promise(() => {}), {signal: controller.signal})); // eslint-disable-line @typescript-eslint/no-empty-function
		}

		controller.abort();

		// eslint-disable-next-line no-await-in-loop
		const results = await Promise.allSettled(promises);
		t.is(results.filter(result => result.status === 'rejected').length, count, `concurrency ${concurrency}`);
		t.is(queue.size, 0, `concurrency ${concurrency}`);
		t.is(queue.pending, 0, `concurrency ${concurrency}`);
	}
});

// Cancelled jobs are skipped, but runnable jobs interspersed between them must
// still run, in queue order, and their promises must resolve normally.
test('mass abort with runnable jobs interspersed', async t => {
	const queue = new PQueue({concurrency: 1});
	const controller = new AbortController();

	const count = 6000;
	const promises = [];
	const runnableIndexes = new Set<number>();
	const ran: number[] = [];

	for (let index = 0; index < count; index++) {
		// Every 250th job is runnable and does not use the shared signal.
		const isRunnable = index % 250 === 0;
		if (isRunnable) {
			runnableIndexes.add(index);
		}

		promises.push(queue.add(
			async () => {
				if (isRunnable) {
					ran.push(index);
					return index;
				}

				// eslint-disable-next-line @typescript-eslint/no-empty-function
				return new Promise(() => {});
			},
			isRunnable ? undefined : {signal: controller.signal},
		));
	}

	controller.abort();

	const results = await Promise.allSettled(promises);

	const rejected = results
		.map((result, index) => ({result, index}))
		.filter(({result}) => result.status === 'rejected');
	const fulfilled = results.filter(result => result.status === 'fulfilled');

	t.is(rejected.length, count - runnableIndexes.size);
	t.is(fulfilled.length, runnableIndexes.size);
	t.is(ran.length, runnableIndexes.size);

	// Runnable jobs must execute in queue order even though they are surrounded
	// by jobs that are skipped.
	t.deepEqual(ran, [...runnableIndexes]);

	t.is(queue.size, 0);
	t.is(queue.pending, 0);
});

// Priority must still be honored while skipping cancelled jobs.
test('mass abort preserves priority order among runnable jobs', async t => {
	const queue = new PQueue({concurrency: 1});
	const controller = new AbortController();

	const count = 3000;
	const promises = [];
	const labels: string[] = [];
	const order: string[] = [];

	// All cancelled jobs use the shared signal. Runnable jobs get descending
	// priority (so the first added runnable has the highest priority), while the
	// cancelled jobs sit at priority 0.
	for (let index = 0; index < count; index++) {
		const isRunnable = index % 500 === 0;
		const label = `r${index}`;

		if (isRunnable) {
			labels.push(label);
		}

		promises.push(queue.add(
			async () => {
				if (isRunnable) {
					order.push(label);
					return index;
				}

				// eslint-disable-next-line @typescript-eslint/no-empty-function
				return new Promise(() => {});
			},
			{
				priority: isRunnable ? count - index : 0,
				signal: isRunnable ? undefined : controller.signal,
			},
		));
	}

	controller.abort();

	await Promise.allSettled(promises);

	// Runnable jobs were enqueued in ascending index order but given descending
	// priority, so they must run in the same order they were enqueued.
	t.deepEqual(order, labels);
	t.is(queue.size, 0);
	t.is(queue.pending, 0);
});

// Pausing must stop the drain; resuming after abort must finish skipping the
// cancelled jobs and settle every promise.
test('mass abort drains after pause then resume', async t => {
	const queue = new PQueue({concurrency: 2, autoStart: false});
	const controller = new AbortController();

	const count = 5000;
	const promises = [];
	for (let index = 0; index < count; index++) {
		promises.push(queue.add(async () => new Promise(() => {}), {signal: controller.signal})); // eslint-disable-line @typescript-eslint/no-empty-function
	}

	// Abort while paused: nothing has run yet, so all jobs are still queued.
	controller.abort();
	t.is(queue.pending, 0);
	t.is(queue.size, count);

	queue.start();

	const results = await Promise.allSettled(promises);
	t.is(results.filter(result => result.status === 'rejected').length, count);
	t.is(queue.size, 0);
	t.is(queue.pending, 0);
});

// Pause partway through a drain, then resume: the queued runnable job stays
// queued while paused and runs after resume.
test('mass abort paused mid-drain and resumed', async t => {
	const queue = new PQueue({concurrency: 1});
	const controller = new AbortController();

	const count = 5000;
	const promises = [];
	let runnableRan = false;

	// A runnable (non-aborted) job partway through the chain parks until the
	// test pauses and then resumes the queue, giving a deterministic pause point
	// while cancelled jobs remain queued on both sides of it.
	const gate = pDefer();
	const gateIndex = Math.floor(count / 2);
	const runnableIndex = count - 1;
	const runnableTask = async () => {
		runnableRan = true;
		return 'done';
	};

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	const cancelledTask = async () => new Promise(() => {});

	for (let index = 0; index < count; index++) {
		if (index === gateIndex) {
			promises.push(queue.add(async () => gate.promise));
		} else if (index === runnableIndex) {
			promises.push(queue.add(runnableTask));
		} else {
			promises.push(queue.add(cancelledTask, {signal: controller.signal}));
		}
	}

	// Drain until the gate job is running and cancelled jobs still queue behind.
	controller.abort();
	await delay(30);
	t.is(queue.pending, 1);
	t.true(queue.size > 0);

	queue.pause();
	t.is(queue.isPaused, true);
	t.false(runnableRan);

	// Releasing the gate while paused must not advance the queue.
	gate.resolve();
	await delay(20);
	t.false(runnableRan);
	t.true(queue.size > 0);

	queue.start();

	await Promise.allSettled(promises);
	t.true(runnableRan);
	t.is(queue.size, 0);
	t.is(queue.pending, 0);
});

// Under an intervalCap, skipped (cancelled) jobs must not consume the cap, so a
// runnable job queued behind thousands of cancelled jobs runs in the first
// available window and the queue drains completely.
test('mass abort under an interval window does not consume intervalCap', async t => {
	const queue = new PQueue({concurrency: 1, intervalCap: 1, interval: 50});
	const controller = new AbortController();

	const count = 5000;
	const promises = [];
	let runnableRan = false;

	const runnableTask = async () => {
		runnableRan = true;
		return 'done';
	};

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	const cancelledTask = async () => new Promise(() => {});

	for (let index = 0; index < count; index++) {
		if (index === count - 1) {
			promises.push(queue.add(runnableTask));
		} else {
			promises.push(queue.add(cancelledTask, {signal: controller.signal}));
		}
	}

	const end = timeSpan();
	controller.abort();

	await Promise.allSettled(promises);

	// Cancelled jobs decrement the interval count as they are skipped, so the
	// runnable job starts in a single window rather than waiting through
	// thousands of interval ticks.
	t.true(runnableRan);
	t.true(end() < 400, `drain took too long: ${end()}ms`);
	t.is(queue.size, 0);
	t.is(queue.pending, 0);
});

// Draining a very large backlog must yield to the event loop between slices so
// timers and I/O are not starved.
test('mass abort yields to the event loop while draining', async t => {
	const queue = new PQueue({concurrency: 1});
	const controller = new AbortController();

	const count = 10_000;
	const promises = [];
	const sizesObservedOnEventLoopTurns: number[] = [];

	for (let index = 0; index < count; index++) {
		// Two runnable markers placed beyond slice boundaries. Each records the
		// current queue size on an immediate event-loop task and then aborts
		// itself, allowing the drain to continue.
		const isMarker = index === 2500 || index === 7500;

		if (isMarker) {
			const markerController = new AbortController();

			promises.push(queue.add(async ({signal}) => {
				setImmediate(() => {
					sizesObservedOnEventLoopTurns.push(queue.size);
					markerController.abort();
				});

				await new Promise((_resolve, reject) => {
					signal!.addEventListener('abort', () => {
						reject(signal!.reason);
					}, {once: true});
				});
			}, {signal: markerController.signal}));
		} else {
			promises.push(queue.add(async () => new Promise(() => {}), {signal: controller.signal})); // eslint-disable-line @typescript-eslint/no-empty-function
		}
	}

	controller.abort();

	await Promise.allSettled(promises);

	// Both markers ran on their own event-loop turns while cancelled jobs were
	// still queued behind them. A fully synchronous drain would never let these
	// tasks run mid-drain.
	t.is(sizesObservedOnEventLoopTurns.length, 2);
	t.true(sizesObservedOnEventLoopTurns.every(size => size > 0), 'event loop should run between slices while jobs are queued');

	t.is(queue.size, 0);
	t.is(queue.pending, 0);
});
