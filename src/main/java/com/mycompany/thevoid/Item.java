/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

import java.util.HashMap;
import java.util.Map;



/**
 *
 * @author jihad
 */
public class Item {
        
    String itemName;
    int itemId; //id of the item
    int itemType; //0 armor, 1 weapon, 2 trinket, 3 usable (includes instant damage items for example)
    int itemAC, itemACM; //armor class of the item, armor class modifier (can be only based on dex until now)
    Dice itemAtkRoll; //this is a dice for the atk roll, used for weapons
    String itemProperty; //meelee, ranged, finesse
    int itemCost; //cost of item will be slightly variable internally, but character Charisma will ialso influence on price
    
    //armors (type = 0) id range = 100-200
    Item shirt = new Item("Shirt", 100, 0, , itemACM, itemAtkRoll, itemProperty, itemCost)
    

    public Item(String itemName, int itemId, int itemType, int itemAC, int itemACM, Dice itemAtkRoll, String itemProperty, int itemCost) {
        this.itemName = itemName;
        this.itemId = itemId;
        this.itemType = itemType;
        this.itemAC = itemAC;
        this.itemACM = itemACM;
        this.itemAtkRoll = itemAtkRoll;
        this.itemProperty = itemProperty;
        this.itemCost = itemCost;
    }
    
    
    
    

}
