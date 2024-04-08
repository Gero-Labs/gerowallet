export function groupBy(arr, criteria) {
	return arr.reduce((obj, item) => {
		const key = typeof criteria === 'function' ? criteria(item) : item[criteria];

		if (!obj.hasOwnProperty(key)) {
			obj[key] = [];
		}

		obj[key].push(item);

		return obj;
	}, {});
}

export function flatten(array) {
  return array.reduce((accumulator, value) => accumulator.concat(value), []);
}
