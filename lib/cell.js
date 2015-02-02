/**
 * Copyright (c) 2014 Guyon Roche
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:</p>
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 * 
 */
"use strict";

var _ = require("underscore");
var colCache = require("./colcache");
var utils = require("./utils");
var Enums = require("./enums");

// Cell requirements
//  Operate inside a worksheet
//  Store and retrieve a value with a range of types: text, number, date, hyperlink, reference, formula, etc.
//  Manage/use and manipulate cell format either as local to cell or inherited from column or row.

var Cell = module.exports = function(row, address) {
    if (!row) {
        throw new Error("A Cell needs a Row");
    }
    this._row = row;
    
    colCache.validateAddress(address);
    this._address = address;
    
    this._value = ValuePool.create(Cell.Types.Null, this);
    
    this.styles = {};
    this._mergeCount = 0;
}

Cell.Types = Enums.ValueType;

Cell.prototype = {

    // =========================================================================
    // Styles stuff
    get numFmt() {
        return this.styles.numFmt;
    },
    set numFmt(value) {
        return this.styles.numFmt = value;
    },
    get font() {
        return this.styles.font;
    },
    set font(value) {
        return this.styles.font = value;
    },

    // =========================================================================
    // return the address for this cell
    get address() {
        return this._address;
    },
    
    get row() {
        if (!this._row) {
            this._row = parseInt(this._address.match(/\d+/)[0]);
        }
        return this._row;
    },
    get col() {
        if (!this._col) {
            this._col = colCache.l2n(this._address.match(/[A-Z]+/)[0]);
        }
        return this._col;
    },
    
    get type() {
        return this._value.type;
    },
    
    addMergeRef: function() {
        this._mergeCount++;
    },
    releaseMergeRef: function() {
        this._mergeCount--;
    },
    get isMerged() {
        return (this._mergeCount > 0) || (this.type == Cell.Types.Merge);
    },
    merge: function(master) {
        this._value.release();
        this._value = ValuePool.create(Cell.Types.Merge, this, master);
    },
    unmerge: function() {
        if (this.type == Cell.Types.Merge) {
            this._value.release();
            this._value = ValuePool.create(Cell.Types.Null, this);
        }
    },
    isMergedTo: function(master) {
        if (this._value.type != Cell.Types.Merge) return false;
        return this._value.isMergedTo(master);
    },
    get master() {
        if (this.type == Cell.Types.Merge) return this._value.master;
        else return this; // an unmerged cell is its own master
    },
    
    get isHyperlink() {
        return this._value.type == Cell.Types.Hyperlink;
    },
    get hyperlink() {
        return this._value.hyperlink;
    },
    
    // return the value
    get value() {
        return this._value.value;
    },
    // set the value - can be number, string or raw
    set value(v) {
        // special case - merge cells set their master's value
        if (this.type == Cell.Types.Merge) {
            return this._value.master.value = v;
        }
        
        this._value.release();
        
        // assign value
        this._value = ValuePool.create(Value.getType(v), this, v);
        return v;
    },
    
    _upgradeToHyperlink: function(hyperlink) {
        // if this cell is a string, turn it into a Hyperlink
        if (this.type == Cell.Types.String) {
            this._value = ValuePool.create(Cell.Types.Hyperlink, this, {
                text: this._value._value,
                hyperlink: hyperlink
            });
        }
    },
    
    get model() {
        var model = this._value.model;
        model.styles = this.styles;
        return model;
    },
    set model(value) {
        this._value.release();
        //console.log("Creating from model: " + JSON.stringify(value));
        this._value = ValuePool.create(value.type, this);
        this._value.model = value;
        if (value.styles) {
            this.styles = value.styles;
        } else {
            this.styles = {};
        }
        return value;
    }
}

// =============================================================================
// Internal Value Types

var Value = function(model) {
    this.model = model;
}
Value.getType = function(value) {
    if ((value === null) || (value === undefined)) {
        return Cell.Types.Null;
    } else if ((value instanceof String) || (typeof value == "string")) {
        return Cell.Types.String;
    } else if (typeof value == "number") {
        return Cell.Types.Number;
    } else if (value instanceof Date) {
        return Cell.Types.Date;
    } else if (value.text && value.hyperlink) {
        return Cell.Types.Hyperlink;
    } else if (value.formula) {
        return Cell.Types.Formula;
    } else {
        throw new Error("I could not understand type of value")
    }    
}
Value.prototype = {
    get type() {
        return this.model.type;
    },
    get address() {
        return this.model.address;
    },
    set address(value) {
        return this.model.address = value;
    },
    release: function() {
        ValuePool.release(this);
    }
}

var NullValue = function(cell) {
    Value.call(this, {
        address: cell.address,
        type: Cell.Types.Null
    });
}
utils.inherits(NullValue, Value, {
    get value() {
        return null;
    },
    set value(value) {
        return value;
    }
});

var NumberValue = function(cell, value) {
    Value.call(this, {
        address: cell.address,
        type: Cell.Types.Number,
        value: value
    });
}
utils.inherits(NumberValue, Value, {
    get value() {
        return this.model.value;
    },
    set value(value) {
        return this.model.value = value;
    }
});

var StringValue = function(cell, value) {
    Value.call(this, {
        address: cell.address,
        type: Cell.Types.String,
        value: value
    });
}
utils.inherits(StringValue, Value, {
    get value() {
        return this.model.value;
    },
    set value(value) {
        return this.model.value = value;
    }
});

var DateValue = function(cell, value) {
    Value.call(this, {
        address: cell.address,
        type: Cell.Types.Date,
        value: value
    });
}
utils.inherits(DateValue, Value, {
    get value() {
        return this.model.value;
    },
    set value(value) {
        return this.model.value = value;
    }
});

var HyperlinkValue = function(cell, value) {
    Value.call(this, {
        address: cell.address,
        type: Cell.Types.Hyperlink,
        text: value ? value.text : undefined,
        hyperlink: value ? value.hyperlink : undefined
    });
}
utils.inherits(HyperlinkValue, Value, {
    get value() {
        return {
            text: this.model.text,
            hyperlink: this.model.hyperlink
        };
    },
    set value(value) {
        this.model.text = value.text;
        this.model.hyperlink = value.hyperlink;
        return value;
    },
    
    get text() {
        return this.model.text;
    },
    set text(value) {
        return this.model.text = value;        
    },
    get hyperlink() {
        return this.model.hyperlink;
    },
    set hyperlink(value) {
        return this.model.hyperlink = value;
    }
});

var MergeValue = function(cell, master) {
    Value.call(this, {
        address: cell.address,
        type: Cell.Types.Merge,
        master: master ? master.address : undefined
    });
    this._master = master;
    if (master) {
        master.addMergeRef();
    }
}
utils.inherits(MergeValue, Value, {
    get value() {
        return this._master.value;
    },
    set value(value) {
        if (value instanceof Cell) {
            if (this._master) {
                this._master.releaseMergeRef();
            }
            value.addMergeRef();
            return this._master = value;
        } else {
            return this._master.value = value;
        }
    },
    release: function() {
        this._master.releaseMergeRef();
        ValuePool.release(this);
    },
    
    isMergedTo: function(master) {
        return master === this._master;
    },
    get master() {
        return this._master;
    }
});

var FormulaValue = function(cell, value) {
    Value.call(this, {
        address: cell.address,
        type: Cell.Types.Formula,
        formula: value ? value.formula : undefined, 
        result: value ? value.result : undefined
    });
    
    //cell.calcChain.add(this);
}
utils.inherits(FormulaValue, Value, {
    get value() {
        return {
            formula: this.model.formula,
            result: this.model.result
        };
    },
    set value(value) {
        this.model.formula = value.formula;
        this.model.result = value.result;
        return value;
    },
    validate: function(value) {
        switch (Value.getType(value)) {
            case Cell.Types.Null:
            case Cell.Types.String:
            case Cell.Types.Number:
            case Cell.Types.Date:
                break;
            case Cell.Types.Hyperlink:
            case Cell.Types.Formula:
            default:
                throw new Error("Cannot process that type of result value");
        }
    },
    
    get dependencies() {
        var ranges = this.formula.match(/([a-zA-Z0-9]+!)?[A-Z]{1,3}\d{1,4}:[A-Z]{1,3}\d{1,4}/g)
        var cells = this.formula.replace(/([a-zA-Z0-9]+!)?[A-Z]{1,3}\d{1,4}:[A-Z]{1,3}\d{1,4}/g, "")
                                    .match(/([a-zA-Z0-9]+!)?[A-Z]{1,3}\d{1,4}/g)
        return {
            ranges: ranges,
            cells: cells
        };
    },
    
    get formula() {
        return this.model.formula;
    },
    set formula(value) {
        return this.model.formula = value;
    },
    get result() {
        return this.model.result;
    },
    set result(value) {
        return this.model.result = value;
    }
});

// =============================================================================
// ValuePool
var ValuePool = {
    pools: [],
    types: [
        {t:Cell.Types.Null, f:NullValue},
        {t:Cell.Types.Number, f:NumberValue},
        {t:Cell.Types.String, f:StringValue},
        {t:Cell.Types.Date, f:DateValue},
        {t:Cell.Types.Hyperlink, f:HyperlinkValue},
        {t:Cell.Types.Formula, f:FormulaValue},
        {t:Cell.Types.Merge, f:MergeValue}
    ].reduce(function(p,t){p[t.t]=t.f; return p;}, []),
    getPool: function(type) {
        var pool = this.pools[type];
        if (!pool) {
            this.pools[type] = pool = [];
        }
        return pool;
    },
    create: function(type, cell, value) {
        var pool = this.getPool(type);
        var drop;
        if (pool.length) {
            drop = pool.pop();
            drop.address = cell.address;
            drop.value = value;
        } else {
            var t = this.types[type];
            if (!t) throw new Error("Could not create Value of type " + type);
            drop = new t(cell, value);
        }
        return drop;
    },
    release: function(value) {
        var pool = this.getPool(value.type);
        pool.push(value);
    }
};
