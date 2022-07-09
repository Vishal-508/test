Q. DIFFERENCE BETWEEN PROPS AND STATE?

PROPS: 1)The Data is passed from one component to another.
 2)It is Immutable (cannot be modified).
  3)Props can be used with state and functional components.. 
  4)Props are read-only..

STATE: 1)The Data is passed within the component only. 
2)It is Mutable ( State is both read and write. can be modified). 
3)State can be used only with the state components/class component. 
4) State is both read and write.

Q. Explain The useState API?

-> The useState hook allows you to use local state in your React code. The useState API expects you to provide a variable name for the state you want to use and a setter function to set the state variable you declare.

Q. Explain the how map, filter, reduce work-

-> MAP: MAP is a method built to do exactly that. It's defined on Array.prototype, so you can call it on any array, and it accepts a callback as its first argument.

-> FILTER: It takes an array and filters out unwanted elements.

#. The syntax for filter is:
let newArray = arr.filter(callback(currentValue[ index ,[ array]]) { // return element for newArray, if true }[thisArg]);

-> REDUCE:
#. The syntax for the reduce array method in JavaScript is:
let newArray = arr.filter(callback(currentValue, accumulatedValue) { // return the accumulated value, given the current and previous accumulated value }, //initialValue [thisArg]);